import { Inject, Injectable } from "@nestjs/common";
import type { PrinterSnapshot } from "@platerelay/shared/contract/daemon";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { can, type Ctx, userIdOf } from "../common/ctx.js";
import { DaemonHub } from "../daemons/hub.js";
import { DB, type Db, type Tx } from "../db/db.js";
import { daemons, files, orders, orderVersions, printerErrors, printerLive, printerReasons, printJobs, trayGrams, users } from "../db/schema.js";
import type { PrinterRow } from "../jobs/printer-state.js";
import type { NozzleSpec, TrayState } from "./mapping.js";

/* Standard states in which the printer is running a job. */
export const RUNNING_STATES = new Set(["PREPARING", "PRINTING", "PAUSED", "ERROR_PAUSED"]);

export interface TrayView {
  unit: number;
  slot: number;
  label: string;
  material: string | null;
  subType: string | null;
  colour: string | null;
  remainingGrams: number;
  gramsUnconfirmed: boolean;
  rfid: boolean;
  serial: string | null;
  extruders: number[];
}

const trayLabel = (unit: number, slot: number) => (unit < 0 ? "Ext" : `${String.fromCharCode(65 + unit)}${slot + 1}`);

/** What the API returns for printers, cut to what the caller may see. Everything shown about what a printer is doing comes from its own latest report. */
@Injectable()
export class PrinterViews {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly hub: DaemonHub,
  ) {}

  async live(printerId: string, tx: Tx = this.db) {
    const [l] = await tx.select().from(printerLive).where(eq(printerLive.printerId, printerId));
    return l ? { ...l, snapshot: l.snapshot as PrinterSnapshot } : undefined;
  }

  /** Trays as the printer reports them, with the gram count the panel keeps for each. */
  async trays(printerId: string, snapshot: PrinterSnapshot | undefined, tx: Tx = this.db): Promise<TrayView[]> {
    const grams = new Map((await tx.select().from(trayGrams).where(eq(trayGrams.printerId, printerId))).map((g) => [`${g.unit}/${g.slot}`, g]));
    return (snapshot?.trays ?? []).map((t) => {
      const g = grams.get(`${t.unit}/${t.slot}`);
      return {
        unit: t.unit,
        slot: t.slot,
        label: t.label ?? trayLabel(t.unit, t.slot),
        material: t.material ?? null,
        subType: t.subType ?? null,
        colour: t.colour ?? null,
        remainingGrams: g?.grams ?? 0,
        gramsUnconfirmed: g?.unconfirmed ?? false,
        rfid: !!t.rfidUid,
        serial: t.rfidUid ?? null,
        extruders: t.extruders ?? [],
      };
    });
  }

  trayStates(trays: TrayView[]): TrayState[] {
    return trays.map((t) => ({ unit: t.unit, slot: t.slot, material: t.material, subType: t.subType, colour: t.colour, extruders: t.extruders, remainingGrams: t.remainingGrams }));
  }

  nozzlesOf(p: Pick<PrinterRow, "capabilities">): NozzleSpec[] {
    return ((p.capabilities as { nozzles?: NozzleSpec[] }).nozzles ?? []) as NozzleSpec[];
  }

  async cards(ctx: Ctx, rows: PrinterRow[], tx: Tx = this.db) {
    if (!rows.length) return [];
    const ids = rows.map((p) => p.id);
    const lives = new Map((await tx.select().from(printerLive).where(inArray(printerLive.printerId, ids))).map((l) => [l.printerId, l]));
    const reasons = await tx.select().from(printerReasons).where(inArray(printerReasons.printerId, ids)).orderBy(asc(printerReasons.since));
    const jobIds = rows.map((p) => p.currentJobId).filter((x): x is string => !!x);
    const jobs = jobIds.length
      ? await tx
          .select({ job: printJobs, number: orders.number, ownerId: orders.ownerId, ownerName: users.displayName, fileName: files.fileName })
          .from(printJobs)
          .innerJoin(orders, eq(orders.id, printJobs.orderId))
          .innerJoin(users, eq(users.id, orders.ownerId))
          .innerJoin(orderVersions, eq(orderVersions.id, printJobs.versionId))
          .innerJoin(files, eq(files.id, orderVersions.fileId))
          .where(and(inArray(printJobs.id, jobIds), ne(printJobs.phase, "ENDED")))
      : [];
    const seeNames = can(ctx, "order:submitter-name:view-others");
    const seeFiles = can(ctx, "overview:filename:view") || can(ctx, "order:view:any");

    return rows.map((p) => {
      const s = lives.get(p.id)?.snapshot as PrinterSnapshot | undefined;
      const mine = reasons.filter((r) => r.printerId === p.id);
      const offline = mine.some((r) => r.reason === "OFFLINE");
      const j = jobs.find((x) => x.job.id === p.currentJobId);
      /* While the printer cannot be reached its last report is stale: progress and temperatures are not shown. */
      const reported = !offline && s?.job ? s.job : null;
      const ours = !!j && reported?.jobRef === j.job.id && !reported.external;
      const progress = { percent: reported && (ours || !j) && typeof reported.percent === "number" ? Math.round(reported.percent) : null, remainingSeconds: (reported && (ours || !j) ? reported.remainingSeconds : null) ?? null, layer: reported?.layer ?? null, totalLayers: reported?.totalLayers ?? null };
      const job = j
        ? {
            jobId: j.job.id,
            orderId: j.job.orderId,
            orderNumber: j.number,
            owner: seeNames || j.ownerId === userIdOf(ctx) ? { id: j.ownerId, name: j.ownerName, avatarUrl: null } : { id: null, name: "", avatarUrl: null },
            ...(seeFiles || j.ownerId === userIdOf(ctx) ? { fileName: j.fileName } : {}),
            external: false,
            phase: j.job.phase,
            pausedFrom: j.job.pausedFrom,
            substage: (!offline && s?.substage) || null,
            ...progress,
          }
        : p.externalRunning
          ? { jobId: null, orderId: null, orderNumber: null, owner: null, ...(can(ctx, "order:view:any") && reported?.name ? { fileName: reported.name } : {}), external: true, phase: null, pausedFrom: null, substage: (!offline && s?.substage) || null, ...progress }
          : null;
      return {
        id: p.id,
        name: p.name,
        modelName: p.modelName,
        state: p.state,
        stateSince: p.stateSince.toISOString(),
        pauseReason: j?.job.phase === "PAUSED" ? j.job.pauseReason : null,
        reasons: mine.map((r) => r.reason),
        externalRunning: p.externalRunning,
        starred: p.starred,
        openToApplicants: p.openToApplicants,
        job,
        temps: (!offline && s?.temps) || {},
        camera: { stream: "none" as const, snapshotAt: null },
        /* Can be opened to applicants once the printer has told its model: submissions are matched by it. */
        openable: !!p.modelId,
      };
    });
  }

  async card(ctx: Ctx, p: PrinterRow, tx: Tx = this.db) {
    return (await this.cards(ctx, [p], tx))[0];
  }

  async details(ctx: Ctx, rows: PrinterRow[], tx: Tx = this.db) {
    const cards = await this.cards(ctx, rows, tx);
    const daemonRows = rows.length ? await tx.select().from(daemons).where(inArray(daemons.id, [...new Set(rows.map((p) => p.daemonId))])) : [];
    return Promise.all(
      rows.map(async (p, i) => {
        const live = await this.live(p.id, tx);
        const s = live?.snapshot;
        const d = daemonRows.find((x) => x.id === p.daemonId)!;
        const reasons = await tx.select().from(printerReasons).where(eq(printerReasons.printerId, p.id)).orderBy(asc(printerReasons.since));
        const errors = await tx
          .select()
          .from(printerErrors)
          .where(and(eq(printerErrors.printerId, p.id), isNull(printerErrors.clearedAt)))
          .orderBy(asc(printerErrors.raisedAt));
        return {
          ...cards[i],
          brand: p.brand,
          serial: p.serial,
          host: p.host,
          daemon: { id: d.id, name: d.name, online: this.hub.isOnline(d.id) },
          disabledAt: p.disabledAt?.toISOString() ?? null,
          modelId: p.modelId,
          nozzles: this.nozzlesOf(p).map((n) => ({ extruder: n.extruder, side: n.extruder === 1 ? "LEFT" : "RIGHT", diameterMm: n.diameterMm, flow: /high/i.test(n.flow ?? "") ? "HIGH" : "STANDARD" })),
          trays: await this.trays(p.id, s, tx),
          bedType: p.bedType,
          storage: (s?.storage ?? []).map((m) => ({ medium: m.medium, present: m.present, writable: m.writable ?? false, freeBytes: m.freeBytes ?? null })),
          attention: reasons.map((r) => ({ reason: r.reason, since: r.since.toISOString(), jobId: r.jobId, note: r.note })),
          activeErrors: errors.map(errorView),
          controls: Array.isArray(s?.controls) ? (s.controls as unknown[]) : [],
          maintenanceReason: reasons.find((r) => r.reason === "MAINTENANCE")?.note ?? null,
          /* The access code was encrypted for one daemon key; after the daemon's key changes it has to be entered again. */
          accessCode: { set: !!p.accessCodeCipher, keyMatches: !!p.accessCodeCipher && p.accessCodeKeyFingerprint === d.keyFingerprint },
          currentDispatchId: p.currentJobId,
          version: p.version,
          lastReportAt: live?.reportedAt.toISOString() ?? null,
        };
      }),
    );
  }

  async detail(ctx: Ctx, p: PrinterRow, tx: Tx = this.db) {
    return (await this.details(ctx, [p], tx))[0];
  }
}

export function errorView(e: typeof printerErrors.$inferSelect) {
  return {
    errorId: e.errorId,
    vendorCode: e.vendorCode,
    channel: e.channel,
    severity: e.severity,
    module: e.module,
    message: e.message,
    helpUrl: e.helpUrl,
    actions: (e.actions as { action: string; label: string; requiresOnSite: boolean; destructive: boolean }[]).map((a) => ({ action: a.action, label: a.label, requiresOnSite: a.requiresOnSite, destructive: a.destructive })),
    raisedAt: e.raisedAt.toISOString(),
  };
}
