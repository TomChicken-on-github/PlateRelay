import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { can, type Ctx } from "../common/ctx.js";
import { DB, type Db } from "../db/db.js";
import { orders, orderVersions, printerReasons, printers, printJobs, trayGrams } from "../db/schema.js";
import type { MappingEntry } from "../jobs/job-engine.js";
import type { NozzleSpec } from "../printers/mapping.js";
import { PrinterViews } from "../printers/views.js";
import { SettingsService } from "../settings/settings.service.js";

interface Todo {
  kind: "REVIEW" | "STORE" | "ATTENTION" | "PAUSED_TOO_LONG" | "START_UNCONFIRMED" | "BYPASSED" | "UNCLAIMED" | "CLEAR_BED" | "LOW_FILAMENT";
  since: string;
  orderId: string | null;
  printerId: string | null;
  data: Record<string, unknown>;
}

/** The pages that show many things at once: the overview, what can be printed right now, and what is waiting for staff. All of it is worked out on request from current rows. */
@Injectable()
export class OverviewService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly printerViews: PrinterViews,
    private readonly settings: SettingsService,
  ) {}

  async overview(ctx: Ctx) {
    const rows = await this.db.select().from(printers).where(isNull(printers.disabledAt)).orderBy(desc(printers.starred), asc(printers.name));
    const count = async (status: "QUEUED" | "PENDING_REVIEW") => (await this.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(eq(orders.status, status)))[0].n;
    return {
      printers: await this.printerViews.cards(ctx, rows),
      queue: { waiting: await count("QUEUED"), ...(can(ctx, "order:review") ? { pendingReview: await count("PENDING_REVIEW") } : {}) },
    };
  }

  /** What an applicant can slice for: the open printers by model, with their nozzles. */
  async resources() {
    const rows = await this.db
      .select()
      .from(printers)
      .where(and(eq(printers.openToApplicants, true), isNull(printers.disabledAt), isNotNull(printers.modelId)));
    const byModel = new Map<string, { modelId: string; modelName: string; nozzles: unknown[]; count: number; available: number; bedTypes: string[] }>();
    for (const p of rows) {
      const m = byModel.get(p.modelId!) ?? { modelId: p.modelId!, modelName: p.modelName ?? p.modelId!, nozzles: [], count: 0, available: 0, bedTypes: [] };
      m.count++;
      if (p.state === "AVAILABLE") m.available++;
      if (!m.nozzles.length) m.nozzles = this.printerViews.nozzlesOf(p).map((n: NozzleSpec) => ({ extruder: n.extruder, side: n.extruder === 1 ? "LEFT" : "RIGHT", diameterMm: n.diameterMm, flow: /high/i.test(n.flow ?? "") ? "HIGH" : "STANDARD" }));
      byModel.set(p.modelId!, m);
    }
    return { printers: [...byModel.values()], catalog: [], wait: null, bedTypes: [] };
  }

  /** Everything waiting for a person, oldest first. Each item goes away by itself when what caused it is dealt with. */
  async todo(ctx: Ctx): Promise<Todo[]> {
    const out: Todo[] = [];
    const now = Date.now();
    const printing = await this.settings.get("printing");
    const iso = (d: Date) => d.toISOString();

    if (can(ctx, "order:review")) {
      for (const o of await this.db.select().from(orders).where(eq(orders.status, "PENDING_REVIEW"))) out.push({ kind: "REVIEW", since: iso(o.submittedAt), orderId: o.id, printerId: null, data: { number: o.number, revision: o.pendingVersionId !== null } });
    }
    if (can(ctx, "printer:operate")) {
      const stored = await this.db
        .select({ order: orders, endedAt: printJobs.endedAt })
        .from(orders)
        .leftJoin(printJobs, eq(printJobs.id, orders.currentJobId))
        .where(eq(orders.status, "PRINTED"));
      for (const { order: o, endedAt } of stored) out.push({ kind: "STORE", since: iso(endedAt ?? o.submittedAt), orderId: o.id, printerId: o.printerId, data: { number: o.number } });

      const live = await this.db.select().from(printers).where(isNull(printers.disabledAt));
      const reasons = await this.db.select().from(printerReasons);
      for (const p of live) {
        if (p.state === "ATTENTION") {
          const mine = reasons.filter((r) => r.printerId === p.id);
          out.push({ kind: "ATTENTION", since: iso(p.stateSince), orderId: null, printerId: p.id, data: { name: p.name, reasons: mine.map((r) => r.reason) } });
        }
        /* A bed with a finished print on it is already listed as "store"; this is for beds with nothing to store. */
        if (p.state === "CLEARING_REQUIRED" && !stored.some((s) => s.order.printerId === p.id && s.order.currentJobId === p.currentJobId)) out.push({ kind: "CLEAR_BED", since: iso(p.stateSince), orderId: null, printerId: p.id, data: { name: p.name } });
      }

      const jobs = await this.db
        .select({ job: printJobs, number: orders.number, filaments: orderVersions.filaments })
        .from(printJobs)
        .innerJoin(orders, eq(orders.id, printJobs.orderId))
        .innerJoin(orderVersions, eq(orderVersions.id, printJobs.versionId))
        .where(ne(printJobs.phase, "ENDED"));
      for (const { job, number } of jobs) {
        const age = now - job.phaseSince.getTime();
        /* The start command went out but the printer never showed the job: someone should look, and stop it if need be. */
        if (job.phase === "PREPARING" && !job.preparedAt && age > printing.startUnconfirmedSeconds * 1000) out.push({ kind: "START_UNCONFIRMED", since: iso(job.phaseSince), orderId: job.orderId, printerId: job.printerId, data: { number, jobId: job.id } });
        if (job.phase === "PAUSED" && age > printing.pausedReminderMinutes * 60_000) out.push({ kind: "PAUSED_TOO_LONG", since: iso(job.phaseSince), orderId: job.orderId, printerId: job.printerId, data: { number, jobId: job.id, reason: job.pauseReason } });
      }

      const { bypassReminderMinutes } = await this.settings.get("queue");
      const bypassed = await this.db
        .select()
        .from(orders)
        .where(and(eq(orders.status, "QUEUED"), lt(orders.bypassedSince, new Date(now - bypassReminderMinutes * 60_000))));
      for (const o of bypassed) out.push({ kind: "BYPASSED", since: iso(o.bypassedSince!), orderId: o.id, printerId: null, data: { number: o.number } });

      const { unclaimedReminderHours } = await this.settings.get("pickup");
      const unclaimed = await this.db
        .select({ order: orders, endedAt: printJobs.endedAt })
        .from(orders)
        .leftJoin(printJobs, eq(printJobs.id, orders.currentJobId))
        .where(eq(orders.status, "READY"));
      for (const { order: o, endedAt } of unclaimed) if (endedAt && now - endedAt.getTime() > unclaimedReminderHours * 3_600_000) out.push({ kind: "UNCLAIMED", since: iso(endedAt), orderId: o.id, printerId: null, data: { number: o.number, slot: o.storageSlot } });

      /* Trays that will be nearly empty once the current job is done: what is counted now, minus what the job still needs. */
      const { refillBelowGrams } = await this.settings.get("mapping");
      if (refillBelowGrams > 0) {
        const trays = live.length ? await this.db.select().from(trayGrams).where(inArray(trayGrams.printerId, live.map((p) => p.id))) : [];
        for (const t of trays) {
          if (!(t.loadedTag as { present?: boolean }).present) continue;
          const running = jobs.find((j) => j.job.printerId === t.printerId);
          const entry = (running?.job.mapping as { entries: MappingEntry[] } | undefined)?.entries.find((m) => m.tray.unit === t.unit && m.tray.slot === t.slot);
          const planned = entry ? ((running!.filaments as { slot: number; usedGrams: number }[]).find((f) => f.slot === entry.sliceSlot)?.usedGrams ?? 0) : 0;
          const left = Math.round(t.grams - planned * (1 - (running?.job.lastPercent ?? 0) / 100));
          if (left < refillBelowGrams) out.push({ kind: "LOW_FILAMENT", since: iso(t.updatedAt), orderId: null, printerId: t.printerId, data: { unit: t.unit, slot: t.slot, gramsAfterJob: Math.max(0, left) } });
        }
      }
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
  }
}
