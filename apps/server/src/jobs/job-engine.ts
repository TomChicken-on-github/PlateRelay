import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Ctx } from "../common/ctx.js";
import type { Uow } from "../core/uow.js";
import { daemonCommands, orders, orderVersions, printerReasons, printers, printJobs, trayGrams } from "../db/schema.js";
import { record, type RecordKind } from "../orders/records.js";
import { SettingsService } from "../settings/settings.service.js";
import { addReason, removeReason, settlePrinter } from "./printer-state.js";

export type JobRow = typeof printJobs.$inferSelect;
export type JobOutcome = NonNullable<JobRow["outcome"]>;
export type PauseReason = NonNullable<JobRow["pauseReason"]>;

export interface MappingEntry {
  sliceSlot: number;
  extruder: number | null;
  tray: { unit: number; slot: number };
  suggested?: { unit: number; slot: number } | null;
  checks?: { rule: string; result: string; deltaE?: number | null }[];
  mismatchReason?: string | null;
  reasonVisibleToApplicant?: boolean;
}

export interface EndDetails {
  /** Why it failed or was stopped: the reason picked when stopping, or what the printer said. */
  failReason?: string | null;
  /** Shown on the timeline record. */
  note?: string | null;
  noteVisible?: boolean;
  /** Timeline record to write instead of the default for the outcome. */
  recordKind?: RecordKind;
  /** SEND_FAILED only: what the daemon reported. No "send failed" reason is raised when the printer was simply busy or had been used. */
  sendFailure?: { code: string | null; attempts?: unknown };
  data?: Record<string, unknown>;
}

/* Where each outcome takes the order, and the timeline record it leaves. */
const OUTCOME = {
  FINISHED: { order: "PRINTED", record: "print.finished" },
  FAILED: { order: "FAILED", record: "print.failed" },
  STOPPED_BEFORE_START: { order: "QUEUED", record: "dispatch.stopped_before_start" },
  START_FAILED: { order: "QUEUED", record: "dispatch.start_failed" },
  SEND_FAILED: { order: "QUEUED", record: "dispatch.send_failed" },
} as const satisfies Record<JobOutcome, { order: string; record: RecordKind }>;

/* The printer was busy or had run something since the dispatch: nothing is wrong with the transfer itself. */
const NOT_A_TRANSFER_PROBLEM = new Set(["printer_busy", "printer_used"]);

/**
 * The only place that moves an order into or out of DISPATCHED, PRINTING, FAILED and PRINTED, and a
 * printer into or out of work on account of a system job. Whatever happens to a print (the printer
 * reports it, the daemon reports it, a person judges it) is first applied to the print job; the
 * job's change then moves the order and the printer, all in the caller's transaction:
 *
 *   job created                  order → DISPATCHED          printer → working
 *   → preparing, ⇄ paused        order unchanged             error and runout pauses raise a reason
 *   → printing                   order → PRINTING
 *   ended FINISHED               order → PRINTED             printer → clearing required
 *   ended FAILED                 order → FAILED              printer → clearing required
 *   ended before the start       order → QUEUED, same place  printer → clearing required
 *   ended SEND_FAILED            order → QUEUED, same place  printer gets the "send failed" reason
 *
 * Callers hold the printer's row lock (lockPrinter) before calling anything here.
 */
@Injectable()
export class JobEngine {
  constructor(private readonly settings: SettingsService) {}

  /** Dispatch: a new job for a queued order on an available printer. The caller has checked both. */
  async create(
    u: Uow,
    ctx: Ctx,
    input: {
      orderId: string;
      versionId: string;
      versionN: number;
      printerId: string;
      mapping: MappingEntry[];
      mappingSettingsVersion: number;
      bedType: string | null;
      suggested: boolean;
      bypassedOrderIds: string[];
      dispatchedBy: string | null;
    },
  ): Promise<JobRow> {
    const [{ attempts }] = await u.tx.select({ attempts: sql<number>`count(*)::int` }).from(printJobs).where(eq(printJobs.orderId, input.orderId));
    const [job] = await u.tx
      .insert(printJobs)
      .values({
        attempt: attempts + 1,
        orderId: input.orderId,
        versionId: input.versionId,
        printerId: input.printerId,
        dispatchedBy: input.dispatchedBy,
        suggested: input.suggested,
        bypassedOrderIds: input.bypassedOrderIds,
        bedType: input.bedType,
        mapping: { entries: input.mapping },
        mappingSettingsVersion: input.mappingSettingsVersion,
      })
      .returning();
    await u.tx.update(orders).set({ status: "DISPATCHED", printerId: input.printerId, currentJobId: job.id, bypassedSince: null }).where(eq(orders.id, input.orderId));
    await u.tx.update(printers).set({ currentJobId: job.id }).where(eq(printers.id, input.printerId));
    const mismatches = input.mapping.filter((m) => m.mismatchReason).map((m) => ({ sliceSlot: m.sliceSlot, reason: m.mismatchReason, visible: m.reasonVisibleToApplicant ?? true }));
    await record(u, ctx, { orderId: input.orderId, kind: "dispatch.created", from: "QUEUED", to: "DISPATCHED", versionN: input.versionN, jobId: job.id, data: { attempt: job.attempt, printerId: input.printerId, mismatches } });
    await settlePrinter(u, input.printerId);
    u.queue = true;
    return job;
  }

  /**
   * The start command went out, or the printer reports preparing this job. Only the printer's own
   * report sets prepared_at: that is how the panel knows the start command really arrived.
   */
  async preparing(u: Uow, job: JobRow, reportedByPrinter: boolean, at = new Date()): Promise<JobRow> {
    if (job.phase === "ENDED") return job;
    const set: Partial<JobRow> = {};
    if (job.phase === "TRANSFERRING") Object.assign(set, { phase: "PREPARING", phaseSince: at });
    if (reportedByPrinter && !job.preparedAt) set.preparedAt = at;
    if (!Object.keys(set).length) return job;
    u.printers.add(job.printerId);
    u.orders.add(job.orderId);
    u.todo = true;
    return this.update(u, job, set);
  }

  /** The printer reports the print has begun. */
  async printing(u: Uow, ctx: Ctx, job: JobRow, at = new Date()): Promise<JobRow> {
    if (job.phase === "ENDED" || job.phase === "PRINTING") return job;
    if (job.phase === "PAUSED") {
      /* A pause while preparing that ends with the print starting: the pause is over. */
      job = await this.resume(u, ctx, job, at);
      if (job.phase === "PRINTING") return job;
    }
    const next = await this.update(u, job, { phase: "PRINTING", phaseSince: at, preparedAt: job.preparedAt ?? at, startedAt: job.startedAt ?? at });
    await this.moveOrder(u, ctx, job, "PRINTING", "print.started");
    u.printers.add(job.printerId);
    return next;
  }

  /** The printer reports a pause. Pauses caused by an error or by running out of filament need a person, so the printer gets the ERROR reason; a pause someone asked for does not. */
  async pause(u: Uow, ctx: Ctx, job: JobRow, reason: PauseReason, at = new Date()): Promise<JobRow> {
    if (job.phase === "ENDED") return job;
    const from = job.phase === "PAUSED" ? job.pausedFrom! : job.phase === "PRINTING" ? "PRINTING" : "PREPARING";
    const next = await this.update(u, job, { phase: "PAUSED", phaseSince: job.phase === "PAUSED" ? job.phaseSince : at, pausedFrom: from, pauseReason: reason });
    if (reason !== "USER") await addReason(u, job.printerId, "ERROR", { jobId: job.id });
    else await removeReason(u, job.printerId, "ERROR", job.id);
    if (job.phase !== "PAUSED" || job.pauseReason !== reason) await record(u, ctx, { orderId: job.orderId, kind: "print.paused", jobId: job.id, data: { reason } });
    await settlePrinter(u, job.printerId);
    return next;
  }

  /** The printer reports it carries on. A pause while preparing goes back to preparing: only the printer's own report of the start counts as started. */
  async resume(u: Uow, ctx: Ctx, job: JobRow, at = new Date()): Promise<JobRow> {
    if (job.phase !== "PAUSED") return job;
    const next = await this.update(u, job, {
      phase: job.pausedFrom!,
      phaseSince: at,
      pausedFrom: null,
      pauseReason: null,
      pausedMs: job.pausedMs + Math.max(0, at.getTime() - job.phaseSince.getTime()),
    });
    await removeReason(u, job.printerId, "ERROR", job.id);
    await record(u, ctx, { orderId: job.orderId, kind: "print.resumed", jobId: job.id });
    await settlePrinter(u, job.printerId);
    return next;
  }

  /** The job is over. An ended job never changes again; if its reference shows up running later, that is an external job. */
  async end(u: Uow, ctx: Ctx, job: JobRow, outcome: JobOutcome, d: EndDetails = {}, at = new Date()): Promise<JobRow> {
    if (job.phase === "ENDED") return job;
    const pausedMs = job.phase === "PAUSED" ? job.pausedMs + Math.max(0, at.getTime() - job.phaseSince.getTime()) : job.pausedMs;
    const next = await this.update(u, job, { phase: "ENDED", phaseSince: at, pausedFrom: null, pauseReason: null, pausedMs, outcome, endedAt: at, failReason: d.failReason ?? null });

    const to = OUTCOME[outcome];
    const extra: Partial<typeof orders.$inferInsert> = {};
    if (to.order === "QUEUED") Object.assign(extra, { printerId: null, currentJobId: null });
    if (to.order === "FAILED") {
      const { retentionDays } = await this.settings.get("files");
      Object.assign(extra, { closedAt: at, filesExpireAt: new Date(at.getTime() + retentionDays * 86_400_000) });
    }
    await this.moveOrder(u, ctx, job, to.order, d.recordKind ?? to.record, extra, { note: d.note ?? null, noteVisible: d.noteVisible ?? false, data: { outcome, ...(d.failReason ? { reason: d.failReason } : {}), ...d.data } });
    if (to.order === "QUEUED") u.queue = true;

    await this.deductTrays(u, next);

    /* A start command still on its way is void now: it must not be handed to the daemon again after a reconnect. */
    await u.tx
      .update(daemonCommands)
      .set({ status: "EXPIRED", finishedAt: at })
      .where(and(eq(daemonCommands.jobId, job.id), eq(daemonCommands.kind, "job.start"), inArray(daemonCommands.status, ["QUEUED", "SENT"])));

    /* Reasons this job raised go with it; the printer keeps any others (unreachable, maintenance…). */
    await u.tx.delete(printerReasons).where(and(eq(printerReasons.printerId, job.printerId), eq(printerReasons.jobId, job.id), inArray(printerReasons.reason, ["ERROR", "JUDGE"])));
    if (outcome === "SEND_FAILED" && !NOT_A_TRANSFER_PROBLEM.has(d.sendFailure?.code ?? "")) {
      await addReason(u, job.printerId, "SEND_FAILED", { jobId: job.id, data: { code: d.sendFailure?.code ?? null, attempts: d.sendFailure?.attempts ?? [] } });
    }
    await settlePrinter(u, job.printerId);
    return next;
  }

  private async update(u: Uow, job: JobRow, set: Partial<JobRow>): Promise<JobRow> {
    const [next] = await u.tx.update(printJobs).set(set).where(eq(printJobs.id, job.id)).returning();
    return next;
  }

  /** Moves the job's order, if the job is still the order's current one. */
  private async moveOrder(
    u: Uow,
    ctx: Ctx,
    job: JobRow,
    to: "PRINTING" | "PRINTED" | "FAILED" | "QUEUED",
    kind: RecordKind,
    extra: Partial<typeof orders.$inferInsert> = {},
    rec: { note?: string | null; noteVisible?: boolean; data?: Record<string, unknown> } = {},
  ) {
    const [order] = await u.tx.select().from(orders).where(eq(orders.id, job.orderId)).for("update");
    if (!order || order.currentJobId !== job.id || (order.status !== "DISPATCHED" && order.status !== "PRINTING")) return;
    await u.tx
      .update(orders)
      .set({ status: to, ...extra })
      .where(eq(orders.id, order.id));
    await record(u, ctx, { orderId: order.id, kind, from: order.status, to, jobId: job.id, ...rec });
    u.todo = true;
  }

  /**
   * Takes what the job used out of each tray's gram count, by the grams the slicer planned per
   * filament: all of it for a finished print, the reported share of it for one that failed or was
   * stopped after starting, nothing for one that never started.
   */
  private async deductTrays(u: Uow, job: JobRow) {
    const share = job.outcome === "FINISHED" ? 1 : job.outcome === "FAILED" ? Math.min(100, Math.max(0, job.lastPercent ?? 0)) / 100 : 0;
    if (!share) return;
    const [version] = await u.tx.select({ filaments: orderVersions.filaments }).from(orderVersions).where(eq(orderVersions.id, job.versionId));
    const planned = new Map((version?.filaments as { slot: number; usedGrams: number }[] | undefined)?.map((f) => [f.slot, f.usedGrams]));
    for (const m of (job.mapping as { entries: MappingEntry[] }).entries) {
      const grams = Math.round((planned.get(m.sliceSlot) ?? 0) * share);
      if (!grams) continue;
      await u.tx
        .update(trayGrams)
        .set({ grams: sql`greatest(0, ${trayGrams.grams} - ${grams})`, updatedAt: new Date() })
        .where(and(eq(trayGrams.printerId, job.printerId), eq(trayGrams.unit, m.tray.unit), eq(trayGrams.slot, m.tray.slot)));
    }
  }
}
