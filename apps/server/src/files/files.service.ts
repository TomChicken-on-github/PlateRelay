import { Inject, Injectable } from "@nestjs/common";
import { Gcode3mfError, type PlateInfo } from "@platerelay/shared";
import { and, eq, isNull } from "drizzle-orm";
import { can, type Ctx, userIdOf } from "../common/ctx.js";
import { notFound, Problem } from "../common/problem.js";
import { uuidv7 } from "../common/uuid.js";
import { DB, type Db } from "../db/db.js";
import { fileChecks, files, printers } from "../db/schema.js";
import { ParseBusy, ParsePool, ParseTimeout } from "../gcode3mf/parse-pool.js";
import type { NozzleSpec, SliceFilament } from "../printers/mapping.js";
import { type ObjectStorage, STORAGE } from "../storage/storage.js";

/** One plate of an uploaded file, as stored with the file's check and copied onto order versions. */
export interface StoredPlate {
  index: number;
  name: string;
  modelId: string;
  modelName: string | null;
  nozzles: (NozzleSpec & { side: "LEFT" | "RIGHT" | null; flow: "STANDARD" | "HIGH" | null })[];
  filaments: SliceFilament[];
  printSeconds: number;
  weightGrams: number;
  slicedBedType: string | null;
  parts: { id: number; name: string }[];
  partsLabelled: boolean;
  thumbnailKey: string | null;
  partsTopKey: string | null;
  partsPickKey: string | null;
}

export interface Finding {
  check: "structure" | "consistency" | "bounds" | "dangerous";
  code: string;
  severity: "REJECT" | "WARN";
  plate: number | null;
  detail: Record<string, unknown>;
}

const SIGNED_URL_SECONDS = 300;

function toStoredPlate(p: PlateInfo, file: { modelName: string | null; bedType: string | null }, keys: Pick<StoredPlate, "thumbnailKey" | "partsTopKey" | "partsPickKey">): StoredPlate {
  return {
    index: p.index,
    name: p.name,
    modelId: p.printerModelId,
    modelName: file.modelName,
    nozzles: p.nozzles.map((n) => ({ extruder: n.extruder, side: n.side ? (n.side.toUpperCase() as "LEFT" | "RIGHT") : null, diameterMm: n.diameter, flow: /high/i.test(n.volumeType) ? "HIGH" : n.volumeType ? "STANDARD" : null })),
    filaments: p.filaments.map((f) => ({ slot: f.slot, extruder: f.extruder, material: f.type, subType: f.presetId || null, colour: f.color.slice(0, 7).toUpperCase(), usedGrams: f.usedGrams })),
    printSeconds: Math.round(p.printSeconds),
    weightGrams: p.weightGrams,
    slicedBedType: file.bedType,
    parts: p.parts,
    partsLabelled: p.partsLabelled,
    ...keys,
  };
}

/**
 * Uploaded .gcode.3mf files. A file is parsed in a worker thread when it arrives; its plates and
 * what the checks found are kept with it. The same person uploading the same bytes again gets the
 * file they already have; files are never shared between people, so nobody can learn what someone
 * else uploaded.
 */
@Injectable()
export class FilesService {
  private readonly pool = ParsePool.fromEnv();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async onModuleDestroy() {
    await this.pool.close();
  }

  async upload(ctx: Ctx, fileName: string, data: Uint8Array) {
    const uploadedBy = userIdOf(ctx)!;
    if (!/\.gcode\.3mf$/i.test(fileName)) throw new Problem(415, "unsupported_file", "only .gcode.3mf files are accepted");
    let parsed;
    const findings: Finding[] = [];
    try {
      parsed = await this.pool.parse(fileName, data);
    } catch (e) {
      if (e instanceof ParseBusy) throw new Problem(503, "parse_busy", "too many files are being parsed");
      if (e instanceof Gcode3mfError && e.code === "too-large") throw new Problem(413, "payload_too_large", e.message);
      /* A file that cannot be read is always refused; this is not configurable. */
      if (e instanceof Gcode3mfError || e instanceof ParseTimeout) findings.push({ check: "structure", code: e instanceof Gcode3mfError ? e.code.replaceAll("-", "_") : "parse_timeout", severity: "REJECT", plate: null, detail: {} });
      else throw e;
    }

    if (parsed) {
      const [same] = await this.db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.uploadedBy, uploadedBy), eq(files.sha256, parsed.sha256), isNull(files.purgedAt)));
      if (same) return this.check(ctx, same.id);
    }

    const id = uuidv7();
    const objectKey = `uploads/${id}.gcode.3mf`;
    const plates: StoredPlate[] = [];
    if (parsed) {
      await this.storage.put(objectKey, data, "application/octet-stream");
      for (const p of parsed.plates) {
        const keys = { thumbnailKey: p.thumbnail ? `plates/${id}/${p.index}.png` : null, partsTopKey: p.partsView ? `plates/${id}/top-${p.index}.png` : null, partsPickKey: p.partsView ? `plates/${id}/pick-${p.index}.png` : null };
        if (p.thumbnail) await this.storage.put(keys.thumbnailKey!, p.thumbnail, "image/png");
        if (p.partsView) {
          await this.storage.put(keys.partsTopKey!, p.partsView.top, "image/png");
          await this.storage.put(keys.partsPickKey!, p.partsView.pick, "image/png");
        }
        plates.push(toStoredPlate(p, { modelName: parsed.printerModel, bedType: parsed.bedType }, keys));
      }
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(files).values({ id, sha256: parsed?.sha256 ?? "", objectKey, fileName, sizeBytes: data.byteLength, uploadedBy, purgedAt: parsed ? null : new Date() });
      await tx.insert(fileChecks).values({ fileId: id, status: "DONE", plates, findings, verdict: findings.some((f) => f.severity === "REJECT") ? "REJECT" : findings.length ? "WARN" : "PASS", finishedAt: new Date() });
    });
    return this.check(ctx, id);
  }

  /** The parse and check result of a file the caller uploaded. */
  async check(ctx: Ctx, fileId: string) {
    const row = await this.load(fileId);
    if (!row || row.file.uploadedBy !== userIdOf(ctx)) throw notFound("file");
    const open = await this.openModels();
    return {
      fileId: row.file.id,
      fileName: row.file.fileName,
      sizeBytes: row.file.sizeBytes,
      status: row.check.status,
      verdict: row.check.verdict,
      plates: await Promise.all((row.check.plates as StoredPlate[]).map((p) => this.plateView(p, open))),
      /* Applicants see what got the file refused; warnings are for the reviewer. */
      findings: (row.check.findings as Finding[]).filter((f) => f.severity === "REJECT" || can(ctx, "order:review")),
    };
  }

  async load(fileId: string) {
    const [row] = await this.db.select({ file: files, check: fileChecks }).from(files).innerJoin(fileChecks, eq(fileChecks.fileId, files.id)).where(eq(files.id, fileId));
    return row;
  }

  /** The plate as the API shows it. `open` is what printers open to applicants can print, to say whether the plate can be submitted at all. */
  async plateView(p: StoredPlate, open?: OpenModel[]) {
    const { slicedBedType: _b, partsLabelled: _l, thumbnailKey, partsTopKey: _t, partsPickKey: _p, ...rest } = p;
    return {
      ...rest,
      thumbnailUrl: thumbnailKey ? await this.storage.signedUrl(thumbnailKey, SIGNED_URL_SECONDS) : null,
      submittable: open ? fits(p, open) : true,
      hints: [] as { code: string; params: Record<string, unknown> }[],
    };
  }

  /** Models and nozzles of the printers applicants may print on. */
  async openModels(): Promise<OpenModel[]> {
    const rows = await this.db
      .select({ modelId: printers.modelId, capabilities: printers.capabilities })
      .from(printers)
      .where(and(eq(printers.openToApplicants, true), isNull(printers.disabledAt)));
    return rows.filter((r) => r.modelId).map((r) => ({ modelId: r.modelId!, nozzles: ((r.capabilities as { nozzles?: NozzleSpec[] }).nozzles ?? []) as NozzleSpec[] }));
  }
}

export interface OpenModel {
  modelId: string;
  nozzles: NozzleSpec[];
}

/** A plate can be submitted when some open printer is the model it was sliced for and has the nozzle sizes it needs. */
export function fits(p: Pick<StoredPlate, "modelId" | "nozzles">, open: OpenModel[]): boolean {
  return open.some((m) => m.modelId === p.modelId && p.nozzles.every((n) => !m.nozzles.length || m.nozzles.some((x) => x.extruder === n.extruder && Math.abs(x.diameterMm - n.diameterMm) < 1e-6)));
}
