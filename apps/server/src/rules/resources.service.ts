import { Inject, Injectable } from "@nestjs/common";
import { type PlateCheck, type ResourceSettings, type ResourcesView, waitBucket } from "@platerelay/shared";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { type Ctx, can } from "../auth/actor.js";
import { DB, type Db } from "../db/db.js";
import { orders, orderVersions, printers } from "../db/schema.js";
import { shownVersion } from "../orders/rows.js";
import type { OrderRow } from "../orders/transition.js";
import { compatible } from "../printers/compat.js";
import type { PrinterRow } from "../printers/printer-state.js";
import { SettingsService } from "../settings/settings.service.js";

type Plate = Pick<OrderRow, "printerModelId" | "nozzles" | "filaments"> & { printerModel?: string | null };

const shortModel = (m: string | null, id: string) => (m ?? id).replace(/^Bambu Lab /, "");
const hex = (c: string) => c.slice(0, 7).toLowerCase();
const down = (p: PrinterRow) => p.state === "OFFLINE" || p.state === "MAINTENANCE";

/** What is on offer this event: one snapshot of the open printers, the queue and the 可用资源 settings. */
export interface Offer {
  settings: ResourceSettings;
  open: PrinterRow[];
  /** material type → colour → model ids that have it; stock colours are marked. */
  materials: Map<string, Map<string, { name: string | null; stock: boolean; modelIds: Set<string> }>>;
}

/**
 * 本场可用资源 (rules doc §1.5): models, nozzles and spools of the printers open to submitters, plus
 * stock spools from the settings. The submit page shows it; uploads are checked against it.
 */
@Injectable()
export class ResourcesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async offer(db: Db = this.db): Promise<Offer> {
    const settings = await this.settings.get("resources");
    const open = await db.select().from(printers).where(eq(printers.openToContestants, true));
    const materials: Offer["materials"] = new Map();
    const add = (type: string, color: string, name: string | null, stock: boolean, modelId: string) => {
      const byColour = materials.get(type) ?? materials.set(type, new Map()).get(type)!;
      const c = byColour.get(hex(color)) ?? byColour.set(hex(color), { name, stock, modelIds: new Set() }).get(hex(color))!;
      c.stock &&= stock;
      c.name ??= name;
      c.modelIds.add(modelId);
    };
    for (const p of open) for (const t of p.trays ?? []) if (p.modelId && t.type) add(t.type, t.color, null, false, p.modelId);
    for (const s of settings.stock) for (const m of s.modelIds) add(s.type, s.color, s.name, true, m);
    return { settings, open, materials };
  }

  /** The table. Hidden rows and manual wait marks only for resource:configure; wait only with queue:wait:view. */
  async view(ctx: Ctx): Promise<ResourcesView> {
    const o = await this.offer();
    const configure = can(ctx, "resource:configure");
    const showWait = o.settings.showWait && can(ctx, "queue:wait:view");
    const work = showWait || configure ? await this.work() : new Map<string, number>();
    const byModel = new Map<string, PrinterRow[]>();
    for (const p of o.open) if (p.modelId) byModel.set(p.modelId, [...(byModel.get(p.modelId) ?? []), p]);
    const order = (cfg: { order?: number } | undefined, i: number) => cfg?.order ?? 1000 + i;
    const models = [...byModel.entries()]
      .map(([modelId, ps], i) => {
        const cfg = o.settings.models[modelId];
        const manual = cfg?.wait ?? null;
        /* spread over the model's printers that are up; none up means no estimate below the top range */
        const up = ps.filter((p) => !down(p)).length;
        const ahead = up ? (work.get(modelId) ?? 0) / up : Number.POSITIVE_INFINITY;
        return {
          sort: order(cfg, i),
          modelId,
          model: shortModel(ps.find((p) => p.model)?.model ?? null, modelId),
          count: ps.length,
          idle: ps.filter((p) => p.state === "IDLE").length,
          nozzles: [...new Set(ps.flatMap((p) => (p.nozzles ?? []).map((n) => n.diameter)))].sort(),
          dual: ps.some((p) => (p.nozzles?.length ?? 0) > 1),
          bedTypes: [...new Set(ps.map((p) => p.bedType).filter((b): b is string => !!b))],
          wait: showWait || configure ? (manual ?? waitBucket(ahead)) : null,
          waitManual: configure && !!manual,
          note: cfg?.note ?? "",
          hidden: !!cfg?.hidden,
        };
      })
      .filter((m) => configure || !m.hidden)
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort: _s, ...m }) => ({ ...m, wait: showWait || configure ? m.wait : null }));
    const materials = [...o.materials.entries()]
      .map(([type, colours], i) => {
        const cfg = o.settings.materials[type];
        return {
          sort: order(cfg, i),
          type,
          colors: [...colours.entries()].map(([color, c]) => ({ color, name: c.name, stock: c.stock, modelIds: [...c.modelIds] })),
          note: cfg?.note ?? "",
          hidden: !!cfg?.hidden,
        };
      })
      .filter((m) => configure || !m.hidden)
      .sort((a, b) => a.sort - b.sort)
      .map(({ sort: _s, ...m }) => m);
    const show = o.settings.show || configure;
    return { show: o.settings.show, bulletin: o.settings.bulletin, colourMissing: o.settings.colourMissing, models: show ? models : [], materials: show ? materials : [] };
  }

  /** Seconds of printing ahead per model: queued plates (frozen ones included) plus what is left of the running ones. */
  private async work(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ modelId: orderVersions.printerModelId, s: orderVersions.printSeconds, status: orders.status, startedAt: orders.startedAt })
      .from(orders)
      .innerJoin(orderVersions, shownVersion)
      .where(or(eq(orders.status, "QUEUED"), eq(orders.status, "PRINTING"), and(eq(orders.status, "PENDING_REVIEW"), isNotNull(orders.queueSeq))));
    const now = Date.now();
    const work = new Map<string, number>();
    for (const r of rows) {
      const left = r.status === "PRINTING" && r.startedAt ? Math.max(0, r.s - (now - r.startedAt.getTime()) / 1000) : r.s;
      work.set(r.modelId, (work.get(r.modelId) ?? 0) + left);
    }
    return work;
  }

  /** Checks a plate against what is on offer: model and nozzles, then materials, then colours. */
  check(o: Offer, plate: Plate): PlateCheck {
    const block: string[] = [];
    const model = shortModel(plate.printerModel ?? null, plate.printerModelId);
    const hidden = o.settings.models[plate.printerModelId]?.hidden;
    const sameModel = o.open.filter((p) => p.modelId === plate.printerModelId);
    if (!sameModel.length || hidden) return { block: [`本场没有开放 ${model}`], missingColours: [] };
    if (!sameModel.some((p) => compatible(plate, p))) {
      const want = [...new Set(plate.nozzles.map((n) => n.diameter))].join(" / ");
      return { block: [`本场的 ${model} 没有 ${want} mm 喷嘴`], missingColours: [] };
    }
    /* nothing reported and no stock entered yet: materials cannot be checked */
    if (!o.materials.size) return { block, missingColours: [] };
    const missingColours: string[] = [];
    for (const f of plate.filaments) {
      const colours = o.settings.materials[f.type]?.hidden ? undefined : o.materials.get(f.type);
      const onModel = colours ? [...colours.entries()].filter(([, c]) => c.modelIds.has(plate.printerModelId)) : [];
      if (!onModel.length) {
        const msg = `本场的 ${model} 没有 ${f.type}`;
        if (!block.includes(msg)) block.push(msg);
        continue;
      }
      if (!onModel.some(([c]) => c === hex(f.color)) && !missingColours.includes(hex(f.color))) missingColours.push(hex(f.color));
    }
    return { block, missingColours };
  }
}
