import { Injectable, Logger } from "@nestjs/common";
import type { CommandResult, PrinterEvent, PrinterSnapshot } from "@platerelay/shared/contract/daemon";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { daemonCtx, printerCtx } from "../common/ctx.js";
import { type Uow, Work } from "../core/uow.js";
import { daemonCommands, orderRecords, printerErrors, printerEvents, printerLive, printerReasons, printers, printJobs, trayGrams } from "../db/schema.js";
import { JobEngine, type JobRow } from "../jobs/job-engine.js";
import { addReason, lockPrinter, type PrinterRow, removeReason, settlePrinter } from "../jobs/printer-state.js";
import { record } from "../orders/records.js";
import { SettingsService } from "../settings/settings.service.js";

/* Standard states in which the printer is running a job. */
const RUNNING = new Set(["PREPARING", "PRINTING", "PAUSED", "ERROR_PAUSED"]);
/* Reports that a job is over are handled whenever they arrive, however late. */
const END_KINDS = new Set(["job.finished", "job.failed", "job.cancelled"]);
const FINAL_COMMAND_STATUS = new Set(["rejected", "expired", "failed", "done"]);

type EventKind = (typeof printerEvents.$inferInsert)["kind"];

/**
 * Applies what daemons report about their printers. Orders and printers change only on reported
 * facts: an event moves the current print job, and the job moves the order and the printer. The
 * panel never guesses; where the reports cannot tell what became of a job, the printer is flagged
 * for a person to judge.
 */
@Injectable()
export class FactsService {
  private readonly log = new Logger("Facts");

  constructor(
    private readonly work: Work,
    private readonly engine: JobEngine,
    private readonly settings: SettingsService,
  ) {}

  /* ───────── connection ───────── */

  /** The daemon is gone: every printer of it becomes unreachable, whatever it was doing. Jobs and orders are left as they are. */
  async daemonLost(daemonId: string) {
    await this.work.run(async (u) => {
      const mine = await u.tx
        .select({ id: printers.id })
        .from(printers)
        .where(and(eq(printers.daemonId, daemonId), isNull(printers.disabledAt)));
      for (const { id } of mine) await this.markUnreachable(u, id, "daemon_disconnected");
    });
  }

  /** At panel start no daemon is connected yet, so nothing stored about reachability can be trusted. */
  async allUnreachable() {
    await this.work.run(async (u) => {
      for (const { id } of await u.tx.select({ id: printers.id }).from(printers).where(isNull(printers.disabledAt))) await this.markUnreachable(u, id, "panel_restarted");
    });
  }

  private async markUnreachable(u: Uow, printerId: string, why: string) {
    const p = await lockPrinter(u, printerId);
    if (!p) return;
    const [had] = await u.tx
      .select({ id: printerReasons.id })
      .from(printerReasons)
      .where(and(eq(printerReasons.printerId, printerId), eq(printerReasons.reason, "OFFLINE")));
    if (had) return;
    await addReason(u, printerId, "OFFLINE", { data: { why } });
    await this.logEvent(u, printerId, "CONNECTION_DOWN", { reason: why }, p.currentJobId);
    await settlePrinter(u, printerId);
  }

  /* ───────── status reports ───────── */

  async snapshot(daemonId: string, s: PrinterSnapshot) {
    await this.work.run(async (u) => {
      const p = await lockPrinter(u, s.printerId);
      if (!p || p.daemonId !== daemonId || p.disabledAt) return;
      const [live] = await u.tx.select().from(printerLive).where(eq(printerLive.printerId, p.id));
      /* Within one start of the daemon reports are numbered; an older one than the last seen is stale. */
      if (live && live.bootId === s.bootId && s.seq < live.seq) return;

      const now = new Date();
      const row = { snapshot: s, bootId: s.bootId, seq: s.seq, runSeq: Math.max(live?.runSeq ?? 0, s.runSeq), reportedAt: now };
      await u.tx
        .insert(printerLive)
        .values({ printerId: p.id, ...row })
        .onConflictDoUpdate({ target: printerLive.printerId, set: row });

      const model = s as PrinterSnapshot & { modelId?: string; modelName?: string };
      await u.tx
        .update(printers)
        .set({
          bedType: s.bedType ?? null,
          modelId: model.modelId ?? p.modelId,
          modelName: model.modelName ?? p.modelName,
          capabilities: { ...(p.capabilities as object), ...(s.nozzles ? { nozzles: s.nozzles } : {}), ...(s.camera ? { camera: s.camera } : {}) },
        })
        .where(eq(printers.id, p.id));
      await this.syncTrays(u, p.id, s);

      const job = await this.activeJob(u, p);
      const reportsOurJob = !!job && s.job?.jobRef === job.id && !s.job.external;
      if (job && reportsOurJob) {
        const set: Partial<JobRow> = {};
        if (typeof s.job!.percent === "number") set.lastPercent = Math.round(s.job!.percent);
        if (s.job!.skippedParts) set.skippedParts = s.job!.skippedParts;
        if (Object.keys(set).length) await u.tx.update(printJobs).set(set).where(eq(printJobs.id, job.id));
      }

      const reachable = s.connected && s.state !== "OFFLINE";
      const [offline] = await u.tx
        .select({ id: printerReasons.id })
        .from(printerReasons)
        .where(and(eq(printerReasons.printerId, p.id), eq(printerReasons.reason, "OFFLINE")));
      if (!reachable) {
        if (!offline) {
          await addReason(u, p.id, "OFFLINE", { data: { why: "printer_unreachable" } });
          await this.logEvent(u, p.id, "CONNECTION_DOWN", { reason: "printer_unreachable" }, p.currentJobId);
        }
      } else if (offline) {
        await this.reconcile(u, p, job, s);
        await u.tx.update(printerLive).set({ reconciledSeq: s.seq }).where(eq(printerLive.printerId, p.id));
      } else if (job && reportsOurJob && RUNNING.has(s.state)) {
        /* The printer itself shows the job: the start command did arrive, and nobody needs to judge a job that is visibly running. */
        if (s.state === "PREPARING" || !job.preparedAt) await this.engine.preparing(u, job, true, now);
        await removeReason(u, p.id, "JUDGE", job.id);
      }
      await settlePrinter(u, p.id);
    });
  }

  /**
   * First report after the printer was unreachable. Three results only: the same job is still going
   * on and is brought up to date; the report says how the job ended and it is ended that way;
   * anything else is left for a person to judge. A printer without a job goes to "running
   * something external" or to "clearing required" — even one that was available before, since
   * nobody knows what happened to it meanwhile.
   */
  private async reconcile(u: Uow, p: PrinterRow, job: JobRow | undefined, s: PrinterSnapshot) {
    const ctx = printerCtx(p.id);
    await removeReason(u, p.id, "OFFLINE");
    await this.logEvent(u, p.id, "CONNECTION_UP", {}, job?.id ?? null);
    const running = RUNNING.has(s.state);
    if (!job) {
      await u.tx.update(printers).set({ externalRunning: running }).where(eq(printers.id, p.id));
      return;
    }
    const ours = s.job?.jobRef === job.id && !s.job.external;
    if (ours && running) {
      await u.tx.update(printers).set({ externalRunning: false }).where(eq(printers.id, p.id));
      await removeReason(u, p.id, "JUDGE", job.id);
      let j = await this.engine.preparing(u, job, true);
      if (s.state === "PRINTING") j = await this.engine.printing(u, ctx, j);
      else if (s.state === "PREPARING") j = await this.engine.resume(u, ctx, j);
      else if (s.state === "PAUSED") j = await this.engine.pause(u, ctx, j, "USER");
      else if (s.state === "ERROR_PAUSED") await this.engine.pause(u, ctx, j, "ERROR");
      return;
    }
    await u.tx.update(printers).set({ externalRunning: running }).where(eq(printers.id, p.id));
    if (s.pendingStarts?.some((x) => x.jobRef === job.id)) return;
    if (ours && s.state === "FINISHED") return void (await this.engine.end(u, ctx, job, "FINISHED"));
    /* Stopped at "failed" but never seen starting: before or after the start cannot be told apart, so that is not a clear ending. */
    if (ours && (s.state === "FAILED" || s.state === "CANCELLED") && job.startedAt) return void (await this.engine.end(u, ctx, job, "FAILED", { failReason: s.state === "CANCELLED" ? "cancelled" : "failed" }));
    if (!ours && job.phase === "TRANSFERRING" && job.startCommandId) {
      /* The start command has no answer yet: the daemon will accept it or report it expired. */
      const [start] = await u.tx.select({ status: daemonCommands.status }).from(daemonCommands).where(eq(daemonCommands.id, job.startCommandId));
      if (start && (start.status === "QUEUED" || start.status === "SENT")) return;
    }
    await addReason(u, p.id, "JUDGE", { jobId: job.id, data: { lastKnown: job.phase, reported: s.state } });
  }

  /** Notices spool changes: a tray that was empty and now holds filament, another RFID spool, or a different material or colour resets its gram count to a full spool, to be confirmed. An emptied tray counts as zero. */
  private async syncTrays(u: Uow, printerId: string, s: PrinterSnapshot) {
    if (!s.trays) return;
    const known = new Map((await u.tx.select().from(trayGrams).where(eq(trayGrams.printerId, printerId))).map((t) => [`${t.unit}/${t.slot}`, t]));
    let spoolGrams: number | undefined;
    for (const t of s.trays) {
      const tag = { present: !!t.material, rfidUid: t.rfidUid ?? null, material: t.material ?? null, colour: t.colour?.toUpperCase() ?? null };
      const old = known.get(`${t.unit}/${t.slot}`);
      if (old && JSON.stringify(old.loadedTag) === JSON.stringify(tag)) continue;
      spoolGrams ??= (await this.settings.get("mapping")).spoolGrams;
      const set = { grams: tag.present ? spoolGrams : 0, unconfirmed: tag.present, loadedTag: tag, updatedAt: new Date(), updatedBy: null };
      await u.tx
        .insert(trayGrams)
        .values({ printerId, unit: t.unit, slot: t.slot, ...set })
        .onConflictDoUpdate({ target: [trayGrams.printerId, trayGrams.unit, trayGrams.slot], set });
    }
  }

  /* ───────── events ───────── */

  async event(daemonId: string, e: PrinterEvent) {
    await this.work.run(async (u) => {
      const p = await lockPrinter(u, e.printerId);
      if (!p || p.daemonId !== daemonId || p.disabledAt) return;
      const [live] = await u.tx.select().from(printerLive).where(eq(printerLive.printerId, p.id));
      /*
       * After a reconciliation the status report is the newer fact. Older events still waiting in
       * the daemon's outbox are dropped: replaying an old "preparing" would look like an external
       * job starting. Endings are the exception.
       */
      if (live?.reconciledSeq != null && live.bootId === e.bootId && e.seq < live.reconciledSeq && !END_KINDS.has(e.kind)) return;
      const ctx = printerCtx(p.id);

      switch (e.kind) {
        case "connection.down":
          await addReason(u, p.id, "OFFLINE", { data: { why: e.data.reason } });
          await this.logEvent(u, p.id, "CONNECTION_DOWN", { reason: e.data.reason }, p.currentJobId);
          break;
        case "connection.up":
          /* Recorded when the status report that follows is reconciled. */
          break;
        case "external.started":
          /* Someone started a print at the printer. It is shown and can be stopped, but no order is touched; when it ends the bed has to be cleared like after any print. */
          await u.tx.update(printers).set({ externalRunning: true }).where(eq(printers.id, p.id));
          await this.judgeIfStartWasSent(u, p);
          break;
        case "external.ended":
          await u.tx.update(printers).set({ externalRunning: false }).where(eq(printers.id, p.id));
          break;
        case "error.raised": {
          const err = e.data.error;
          const job = await this.activeJob(u, p);
          await u.tx
            .insert(printerErrors)
            .values({
              printerId: p.id,
              jobId: job?.id ?? null,
              errorId: err.errorId,
              channel: err.channel,
              vendorCode: err.vendorCode,
              severity: err.severity,
              module: err.module ?? null,
              message: err.message ?? null,
              helpUrl: err.helpUrl ?? null,
              blocksJob: err.blocksJob,
              actions: err.actions,
              raisedAt: new Date(err.raisedAt),
            })
            .onConflictDoNothing();
          await this.logEvent(u, p.id, err.channel === "hms" ? "HMS" : "ERROR", { errorId: err.errorId, vendorCode: err.vendorCode, severity: err.severity, message: err.message ?? null }, job?.id ?? null);
          /* Only errors that hold the print up need a person; informational notices are just shown. */
          if (err.blocksJob) await addReason(u, p.id, "ERROR", { jobId: job?.id ?? null, data: { errorId: err.errorId } });
          break;
        }
        case "error.cleared": {
          await u.tx
            .update(printerErrors)
            .set({ clearedAt: new Date(), clearedBy: e.data.clearedBy })
            .where(and(eq(printerErrors.printerId, p.id), eq(printerErrors.errorId, e.data.errorId), isNull(printerErrors.clearedAt)));
          /* A reason raised while idle or during an external job has no job to end it: it goes when nothing blocking is left. A job's own reason goes when the printer reports it resumed or the job ends. */
          const [blocking] = await u.tx
            .select({ id: printerErrors.id })
            .from(printerErrors)
            .where(and(eq(printerErrors.printerId, p.id), isNull(printerErrors.clearedAt), eq(printerErrors.blocksJob, true)))
            .limit(1);
          if (!blocking) await removeReason(u, p.id, "ERROR", null);
          break;
        }
        case "filament.refilled":
          /* The firmware carried on with another tray of the same filament: logged, nothing else. */
          await this.logEvent(u, p.id, "REFILL", e.data, p.currentJobId);
          break;
        case "timelapse.ready":
          break;
        default:
          await this.jobEvent(u, p, e);
      }
      await settlePrinter(u, p.id);
      void ctx;
    });
  }

  private async jobEvent(u: Uow, p: PrinterRow, e: Extract<PrinterEvent, { jobRef: string; kind: `job.${string}` }>) {
    const ctx = printerCtx(p.id);
    const [job] = await u.tx
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.id, e.jobRef), eq(printJobs.printerId, p.id)));
    if (!job) return void this.log.warn(`printer ${p.id} reported ${e.kind} for a job it was never given: ${e.jobRef}`);
    /* An ended job stays ended. If its file runs again the daemon reports that as an external job. */
    if (job.phase === "ENDED") return;

    switch (e.kind) {
      case "job.staged":
        await this.engine.preparing(u, job, false);
        break;
      case "job.started":
        await this.engine.printing(u, ctx, job);
        await removeReason(u, p.id, "JUDGE", job.id);
        break;
      case "job.paused":
        await this.engine.pause(u, ctx, job, e.data.reason);
        await this.logEvent(u, p.id, "PAUSED", { reason: e.data.reason }, job.id);
        break;
      case "job.resumed":
        await this.engine.resume(u, ctx, job);
        await this.logEvent(u, p.id, "RESUMED", {}, job.id);
        break;
      case "job.parts_skipped": {
        await u.tx.update(printJobs).set({ skippedParts: e.data.partIds }).where(eq(printJobs.id, job.id));
        const fresh = e.data.partIds.filter((id) => !job.skippedParts.includes(id));
        if (fresh.length) await record(u, await this.skipRequester(u, job.id, ctx), { orderId: job.orderId, kind: "parts.skipped", jobId: job.id, noteVisible: true, data: { partIds: fresh } });
        break;
      }
      case "job.finished":
        await this.engine.end(u, ctx, job, "FINISHED");
        break;
      case "job.failed": {
        const stop = e.data.beforeStart ? await this.lastStop(u, job.id) : undefined;
        /* Stopped by a person before it started beats whatever error the printer names for not starting. */
        if (stop) await this.engine.end(u, ctx, job, "STOPPED_BEFORE_START", stop);
        else await this.engine.end(u, ctx, job, e.data.beforeStart ? "START_FAILED" : "FAILED", { failReason: e.data.reason });
        break;
      }
      case "job.cancelled": {
        /* With the id of a stop command: the panel's stop took effect. Without: someone stopped it at the printer. Where the order goes depends only on whether the print had started. */
        const stop = await this.lastStop(u, job.id);
        if (e.data.beforeStart) await this.engine.end(u, ctx, job, "STOPPED_BEFORE_START", stop ?? {});
        else await this.engine.end(u, ctx, job, "FAILED", { ...(stop ?? { failReason: "stopped_on_device" }), recordKind: e.data.commandId || stop ? "print.stopped" : "print.stopped_on_device" });
        break;
      }
    }
  }

  /** The reason given with the latest stop request for a job, to carry onto the record of how it ended. */
  private async lastStop(u: Uow, jobId: string) {
    const [r] = await u.tx
      .select({ note: orderRecords.note, noteVisible: orderRecords.noteVisible })
      .from(orderRecords)
      .where(and(eq(orderRecords.jobId, jobId), eq(orderRecords.kind, "print.stop_requested")))
      .orderBy(desc(orderRecords.id))
      .limit(1);
    return r ? { failReason: r.note, note: r.note, noteVisible: r.noteVisible } : undefined;
  }

  /** Who asked for the latest skip on a job; falls back to the printer when it was done at the machine. */
  private async skipRequester(u: Uow, jobId: string, fallback: ReturnType<typeof printerCtx>) {
    const [c] = await u.tx
      .select({ by: daemonCommands.requestedBy })
      .from(daemonCommands)
      .where(and(eq(daemonCommands.jobId, jobId), eq(daemonCommands.kind, "job.skip_parts")))
      .orderBy(desc(daemonCommands.id))
      .limit(1);
    return c?.by ? { ...fallback, actor: { type: "USER" as const, id: c.by, username: "", displayName: "", role: "APPLICANT" as const, permissions: new Set<never>() } } : fallback;
  }

  /**
   * An external job showed up after the start command for our job went out but before the printer
   * ever reported our job. Whether ours started cannot be told, so a person judges.
   */
  private async judgeIfStartWasSent(u: Uow, p: PrinterRow) {
    const job = await this.activeJob(u, p);
    if (job && job.phase === "PREPARING" && !job.preparedAt) await addReason(u, p.id, "JUDGE", { jobId: job.id, data: { lastKnown: job.phase, reported: "EXTERNAL" } });
  }

  /* ───────── command results ───────── */

  async commandResult(daemonId: string, r: CommandResult) {
    await this.work.run(async (u) => {
      const [seen] = await u.tx
        .select()
        .from(daemonCommands)
        .where(and(eq(daemonCommands.id, r.commandId), eq(daemonCommands.daemonId, daemonId)));
      if (!seen) return;
      const p = seen.printerId ? await lockPrinter(u, seen.printerId) : undefined;
      /* A command may answer "accepted" and later "done" or "failed"; the last answer stands. */
      await u.tx
        .update(daemonCommands)
        .set({ status: r.status.toUpperCase() as "ACCEPTED", result: r, finishedAt: FINAL_COMMAND_STATUS.has(r.status) ? new Date() : null })
        .where(eq(daemonCommands.id, seen.id));
      u.commands.add(seen.id);
      if (!p || !seen.jobId) return;
      const [job] = await u.tx
        .select()
        .from(printJobs)
        .where(and(eq(printJobs.id, seen.jobId), ne(printJobs.phase, "ENDED")));
      if (!job) return;

      if (seen.kind === "job.start" && (r.status === "rejected" || r.status === "expired" || r.status === "failed") && job.phase === "TRANSFERRING") {
        /* The daemon guarantees a refused, expired or failed start is never carried out: the file did not get to print, the order goes back to its place. */
        await this.engine.end(u, daemonCtx(daemonId), job, "SEND_FAILED", { failReason: r.code ?? r.status, sendFailure: { code: r.code ?? r.status, attempts: (r.data as { attempts?: unknown } | undefined)?.attempts }, data: { message: r.message ?? null } });
      } else if (seen.kind === "job.stop" && (r.code === "not_confirmed" || r.code === "not_running")) {
        /* The printer is not running the job and the daemon cannot confirm it never started: nothing was sent to the printer, and a person has to say what became of it. */
        await addReason(u, p.id, "JUDGE", { jobId: job.id, data: { lastKnown: job.phase, reported: "STOP_NOT_CONFIRMED" } });
        await settlePrinter(u, p.id);
      }
    });
  }

  /* ───────── helpers ───────── */

  private async activeJob(u: Uow, p: PrinterRow): Promise<JobRow | undefined> {
    if (!p.currentJobId) return undefined;
    const [job] = await u.tx
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.id, p.currentJobId), ne(printJobs.phase, "ENDED")));
    return job;
  }

  private async logEvent(u: Uow, printerId: string, kind: EventKind, data: object, jobId: string | null = null) {
    await u.tx.insert(printerEvents).values({ printerId, kind, data, jobId });
  }

  /** Commands a daemon has not answered, oldest first: what to send again after it reconnects. */
  async unanswered(u: Uow, daemonId: string) {
    return u.tx
      .select()
      .from(daemonCommands)
      .where(and(eq(daemonCommands.daemonId, daemonId), inArray(daemonCommands.status, ["QUEUED", "SENT"])))
      .orderBy(daemonCommands.id);
  }
}
