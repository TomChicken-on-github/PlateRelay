import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { can, type Ctx, userIdOf } from "../common/ctx.js";
import { jobMismatch, notFound, Problem, ruleViolation, stateConflict, versionConflict } from "../common/problem.js";
import { type Uow, Work } from "../core/uow.js";
import { CommandsService } from "../daemons/commands.service.js";
import { DaemonHub } from "../daemons/hub.js";
import { DB, type Db } from "../db/db.js";
import { daemons, orders, printerErrors, printerEvents, printerReasons, printers, printJobs, trayGrams, users } from "../db/schema.js";
import { JobEngine, type JobOutcome, type JobRow } from "../jobs/job-engine.js";
import { addReason, lockPrinter, type PrinterRow, type PrinterState, removeReason, settlePrinter } from "../jobs/printer-state.js";
import { record } from "../orders/records.js";
import { type ObjectStorage, STORAGE } from "../storage/storage.js";
import { errorView, PrinterViews, RUNNING_STATES } from "./views.js";

export type Judgement = "FAILED" | "PRINTED" | "NOT_STARTED";
const JUDGED: Record<Judgement, JobOutcome> = { FAILED: "FAILED", PRINTED: "FINISHED", NOT_STARTED: "STOPPED_BEFORE_START" };

/**
 * What people do to printers: registering them, maintenance, stopping, judging a print the reports
 * cannot settle, releasing a printer that needs attention, confirming the bed is clear. Commands
 * are handed to the printer's daemon and answered with 202: what then happens is told by the
 * printer's own reports, never assumed.
 */
@Injectable()
export class PrintersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly work: Work,
    private readonly views: PrinterViews,
    private readonly engine: JobEngine,
    private readonly commands: CommandsService,
    private readonly hub: DaemonHub,
    private readonly audit: AuditService,
  ) {}

  /* ───────── reading ───────── */

  async row(printerId: string): Promise<PrinterRow> {
    const [p] = await this.db.select().from(printers).where(eq(printers.id, printerId));
    if (!p) throw notFound("printer");
    return p;
  }

  async list(ctx: Ctx) {
    const rows = await this.db.select().from(printers).orderBy(desc(printers.starred), asc(printers.name));
    return this.views.details(
      ctx,
      rows.filter((p) => !p.disabledAt || can(ctx, "printer:manage")),
    );
  }

  async detail(ctx: Ctx, printerId: string) {
    return this.views.detail(ctx, await this.row(printerId));
  }

  async events(printerId: string, cursor?: string) {
    await this.row(printerId);
    const rows = await this.db
      .select()
      .from(printerEvents)
      .where(and(eq(printerEvents.printerId, printerId), cursor ? lt(printerEvents.id, cursor) : undefined))
      .orderBy(desc(printerEvents.id))
      .limit(51);
    const page = rows.slice(0, 50);
    return { items: page.map((e) => ({ id: e.id, kind: e.kind, at: e.at.toISOString(), jobId: e.jobId, data: e.data as object })), nextCursor: rows.length > 50 ? page[49].id : null };
  }

  async errors(printerId: string, q: { limit?: string; cursor?: string }) {
    await this.row(printerId);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const rows = await this.db
      .select({ e: printerErrors, by: users })
      .from(printerErrors)
      .leftJoin(users, eq(users.id, printerErrors.resolvedBy))
      .where(and(eq(printerErrors.printerId, printerId), q.cursor ? lt(printerErrors.id, q.cursor) : undefined))
      .orderBy(desc(printerErrors.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map(({ e, by }) => ({ error: errorView(e), clearedAt: e.clearedAt?.toISOString() ?? null, clearedBy: (e.clearedBy ?? "UNKNOWN") as "PANEL" | "DEVICE" | "UNKNOWN", resolvedAction: e.resolvedAction, resolvedBy: by ? { id: by.id, name: by.displayName, avatarUrl: null } : null })),
      nextCursor: rows.length > limit ? page[page.length - 1].e.id : null,
    };
  }

  async jobs(printerId: string, q: { limit?: string; cursor?: string }) {
    await this.row(printerId);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const rows = await this.db
      .select({ job: printJobs, number: orders.number, ownerId: orders.ownerId, ownerName: users.displayName })
      .from(printJobs)
      .innerJoin(orders, eq(orders.id, printJobs.orderId))
      .innerJoin(users, eq(users.id, orders.ownerId))
      .where(and(eq(printJobs.printerId, printerId), q.cursor ? lt(printJobs.id, q.cursor) : undefined))
      .orderBy(desc(printJobs.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: await Promise.all(
        page.map(async ({ job, number, ownerId, ownerName }) => ({
          jobId: job.id,
          attempt: job.attempt,
          orderId: job.orderId,
          orderNumber: number,
          owner: { id: ownerId, name: ownerName, avatarUrl: null },
          phase: job.phase,
          outcome: job.outcome,
          dispatchedAt: job.dispatchedAt.toISOString(),
          startedAt: job.startedAt?.toISOString() ?? null,
          endedAt: job.endedAt?.toISOString() ?? null,
          endPhoto: job.endPhotoKey && job.endPhotoAt ? { capturedAt: job.endPhotoAt.toISOString(), url: await this.storage.signedUrl(job.endPhotoKey, 300) } : null,
        })),
      ),
      nextCursor: rows.length > limit ? page[page.length - 1].job.id : null,
    };
  }

  /* ───────── registering ───────── */

  private async daemonFor(u: Uow, daemonId: string, keyFingerprint?: string) {
    const [d] = await u.tx.select().from(daemons).where(eq(daemons.id, daemonId));
    if (!d || d.revokedAt) throw ruleViolation("no such daemon, or it was revoked", { rule: "daemon_unavailable" });
    /* The browser encrypted the access code with this daemon's key; a different key means the daemon could not read it. */
    if (keyFingerprint !== undefined && keyFingerprint !== d.keyFingerprint) throw new Problem(409, "key_changed", "the daemon's key is not the one the access code was encrypted with", { keyFingerprint: d.keyFingerprint });
    return d;
  }

  async create(ctx: Ctx, b: { daemonId: string; brand: string; serial: string; host: string; name: string; accessCodeCipher: string; keyFingerprint: string }) {
    const id = await this.work.run(async (u) => {
      await this.daemonFor(u, b.daemonId, b.keyFingerprint);
      const [clash] = await u.tx
        .select({ name: printers.name })
        .from(printers)
        .where(sql`${printers.name} = ${b.name} or (${printers.brand} = ${b.brand} and ${printers.serial} = ${b.serial})`);
      if (clash) throw ruleViolation(clash.name === b.name ? "that name is in use" : "this printer is already registered", { rule: clash.name === b.name ? "name_taken" : "serial_taken" });
      const [p] = await u.tx
        .insert(printers)
        .values({ brand: b.brand, serial: b.serial, name: b.name, daemonId: b.daemonId, host: b.host, accessCodeCipher: b.accessCodeCipher, accessCodeKeyFingerprint: b.keyFingerprint, accessCodeSetAt: new Date() })
        .returning();
      /* Nothing is known about a printer until its daemon reports it; and the first report leads to "clear the bed", never straight to available. */
      await addReason(u, p.id, "OFFLINE", { data: { why: "not_reported_yet" } });
      await settlePrinter(u, p.id);
      await this.audit.record(ctx, { action: "printer.create", targetType: "printer", targetId: p.id, after: { name: p.name, brand: p.brand, serial: p.serial, host: p.host, daemonId: p.daemonId } }, u.tx);
      u.assignments.add(p.daemonId);
      return p.id;
    });
    return this.detail(ctx, id);
  }

  async update(ctx: Ctx, printerId: string, b: { version: number; name?: string; host?: string; daemonId?: string; accessCodeCipher?: string; keyFingerprint?: string; disabled?: boolean }) {
    await this.work.run(async (u) => {
      const p = await lockPrinter(u, printerId);
      if (!p) throw notFound("printer");
      if (p.version !== b.version) throw versionConflict(p.version);
      const set: Partial<typeof printers.$inferInsert> = { version: p.version + 1 };
      if (b.name !== undefined && b.name !== p.name) {
        const [clash] = await u.tx.select({ id: printers.id }).from(printers).where(eq(printers.name, b.name));
        if (clash) throw ruleViolation("that name is in use", { rule: "name_taken" });
        set.name = b.name;
      }
      if (b.host !== undefined) set.host = b.host;
      const active = await this.activeJob(u, p);
      if (b.daemonId !== undefined && b.daemonId !== p.daemonId) {
        if (active) throw stateConflict(p.state);
        await this.daemonFor(u, b.daemonId);
        set.daemonId = b.daemonId;
        u.assignments.add(b.daemonId);
        /* Until the new daemon reports the printer, nothing is known about it. */
        await addReason(u, p.id, "OFFLINE", { data: { why: "moved_to_another_daemon" } });
      }
      if (b.accessCodeCipher !== undefined) {
        await this.daemonFor(u, set.daemonId ?? p.daemonId, b.keyFingerprint ?? "");
        Object.assign(set, { accessCodeCipher: b.accessCodeCipher, accessCodeKeyFingerprint: b.keyFingerprint, accessCodeSetAt: new Date() });
      }
      if (b.disabled === true && !p.disabledAt) {
        /* Only a printer that has nothing on it can be put away. */
        if (active || p.externalRunning || (p.state !== "AVAILABLE" && p.state !== "ATTENTION")) throw stateConflict(p.state);
        set.disabledAt = new Date();
        set.openToApplicants = false;
        await addReason(u, p.id, "OFFLINE", { data: { why: "disabled" } });
      } else if (b.disabled === false && p.disabledAt) set.disabledAt = null;
      await u.tx.update(printers).set(set).where(eq(printers.id, p.id));
      await settlePrinter(u, p.id);
      const { accessCodeCipher: _c, version: _v, ...logged } = set;
      await this.audit.record(ctx, { action: "printer.update", targetType: "printer", targetId: p.id, before: { name: p.name, host: p.host, daemonId: p.daemonId, disabled: !!p.disabledAt }, after: logged }, u.tx);
      u.assignments.add(p.daemonId);
    });
    return this.detail(ctx, printerId);
  }

  /** Only a printer that never had a job can be deleted; any other is disabled, so its history stays. */
  async remove(ctx: Ctx, printerId: string, version: number) {
    await this.work.run(async (u) => {
      const p = await lockPrinter(u, printerId);
      if (!p) throw notFound("printer");
      if (p.version !== version) throw versionConflict(p.version);
      const [used] = await u.tx.select({ id: printJobs.id }).from(printJobs).where(eq(printJobs.printerId, p.id)).limit(1);
      if (used) throw ruleViolation("this printer has print records; disable it instead", { rule: "has_history" });
      await u.tx.delete(printers).where(eq(printers.id, p.id));
      await this.audit.record(ctx, { action: "printer.delete", targetType: "printer", targetId: p.id, before: { name: p.name, brand: p.brand, serial: p.serial } }, u.tx);
      u.assignments.add(p.daemonId);
      u.printers.add(p.id);
    });
  }

  async setOpen(ctx: Ctx, printerId: string, b: { version: number; open: boolean }) {
    await this.work.run(async (u) => {
      const p = await lockPrinter(u, printerId);
      if (!p) throw notFound("printer");
      if (p.version !== b.version) throw versionConflict(p.version);
      if (b.open && (!p.modelId || p.disabledAt)) throw ruleViolation("the printer has not reported its model yet, or is disabled", { rule: "not_openable" });
      await u.tx
        .update(printers)
        .set({ openToApplicants: b.open, version: p.version + 1 })
        .where(eq(printers.id, p.id));
      await this.audit.record(ctx, { action: "printer.open", targetType: "printer", targetId: p.id, before: { open: p.openToApplicants }, after: { open: b.open } }, u.tx);
      u.printers.add(p.id);
      u.queue = true;
    });
    return this.detail(ctx, printerId);
  }

  async setStar(ctx: Ctx, printerId: string, starred: boolean) {
    await this.work.run(async (u) => {
      const p = await lockPrinter(u, printerId);
      if (!p) throw notFound("printer");
      await u.tx.update(printers).set({ starred }).where(eq(printers.id, p.id));
      u.printers.add(p.id);
    });
    return this.views.card(ctx, await this.row(printerId));
  }

  /** A person corrects how many grams are left in a tray; that also confirms a count the panel had only assumed. */
  async setTrayGrams(ctx: Ctx, printerId: string, unit: number, slot: number, grams: number) {
    await this.work.run(async (u) => {
      const changed = await u.tx
        .update(trayGrams)
        .set({ grams, unconfirmed: false, updatedAt: new Date(), updatedBy: userIdOf(ctx) })
        .where(and(eq(trayGrams.printerId, printerId), eq(trayGrams.unit, unit), eq(trayGrams.slot, slot)))
        .returning({ unit: trayGrams.unit });
      if (!changed.length) throw notFound("tray");
      u.printers.add(printerId);
      u.todo = true;
    });
    const tray = (await this.views.trays(printerId, (await this.views.live(printerId))?.snapshot)).find((t) => t.unit === unit && t.slot === slot);
    if (!tray) throw notFound("tray");
    return tray;
  }

  /* ───────── maintenance, release, bed ───────── */

  private async locked(u: Uow, printerId: string, expectedState?: PrinterState): Promise<PrinterRow> {
    const p = await lockPrinter(u, printerId);
    if (!p) throw notFound("printer");
    if (expectedState && p.state !== expectedState) throw await this.conflict(u, p, expectedState);
    return p;
  }

  private async conflict(u: Uow, p: PrinterRow, expected?: string) {
    const reasons = (await u.tx.select({ reason: printerReasons.reason }).from(printerReasons).where(eq(printerReasons.printerId, p.id))).map((r) => r.reason);
    return new Problem(409, "state_conflict", expected ? `is ${p.state}, expected ${expected}` : `not possible while ${p.state}`, { current: p.state, reasons });
  }

  private async activeJob(u: Uow, p: PrinterRow): Promise<JobRow | undefined> {
    if (!p.currentJobId) return undefined;
    const [job] = await u.tx
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.id, p.currentJobId), ne(printJobs.phase, "ENDED")));
    return job;
  }

  private async has(u: Uow, printerId: string, reason: "OFFLINE" | "JUDGE" | "MAINTENANCE") {
    const [r] = await u.tx
      .select({ id: printerReasons.id })
      .from(printerReasons)
      .where(and(eq(printerReasons.printerId, printerId), eq(printerReasons.reason, reason)));
    return !!r;
  }

  async enterMaintenance(ctx: Ctx, printerId: string, b: { expectedState: PrinterState; reason: string }) {
    await this.work.run(async (u) => {
      const p = await this.locked(u, printerId, b.expectedState);
      if (p.disabledAt) throw stateConflict("DISABLED");
      await addReason(u, p.id, "MAINTENANCE", { note: b.reason, by: userIdOf(ctx) });
      await settlePrinter(u, p.id);
      await this.audit.record(ctx, { action: "printer.maintenance.enter", targetType: "printer", targetId: p.id, reason: b.reason }, u.tx);
    });
    return this.detail(ctx, printerId);
  }

  /** Leaving maintenance never makes a printer available: it goes to "clear the bed" (or back to work if it is running something). */
  async exitMaintenance(ctx: Ctx, printerId: string) {
    await this.work.run(async (u) => {
      const p = await this.locked(u, printerId, "ATTENTION");
      if (!(await removeReason(u, p.id, "MAINTENANCE"))) throw ruleViolation("the printer is not in maintenance", { rule: "not_in_maintenance" });
      await settlePrinter(u, p.id);
      await this.audit.record(ctx, { action: "printer.maintenance.exit", targetType: "printer", targetId: p.id }, u.tx);
    });
    return this.detail(ctx, printerId);
  }

  /**
   * A person decides what became of a job the reports cannot settle: it failed, it finished, or it
   * never started. Not offered while the printer itself shows the job running.
   */
  private async judge(u: Uow, ctx: Ctx, p: PrinterRow, job: JobRow, outcome: Judgement, note: string) {
    const offline = await this.has(u, p.id, "OFFLINE");
    const s = offline ? undefined : (await this.views.live(p.id, u.tx))?.snapshot;
    if (s && RUNNING_STATES.has(s.state) && s.job?.jobRef === job.id && !s.job.external) throw ruleViolation("the printer reports this job running", { rule: "job_running" });
    await this.engine.end(u, ctx, job, JUDGED[outcome], { failReason: outcome === "FAILED" ? note : null, note, recordKind: "print.judged", data: { judgement: outcome } });
    await this.audit.record(ctx, { action: "printer.judge", targetType: "printer", targetId: p.id, reason: note, after: { jobId: job.id, orderId: job.orderId, outcome } }, u.tx);
    /* "Never started" also tells the daemon to make sure of it: the job must not start later. */
    if (outcome === "NOT_STARTED" && this.hub.isOnline(p.daemonId)) await this.commands.enqueue(u, ctx, { daemonId: p.daemonId, printerId: p.id, jobId: job.id, kind: "job.stop", params: { jobRef: job.id } });
  }

  async judgeOrder(ctx: Ctx, orderId: string, b: { expectedStatus: "DISPATCHED" | "PRINTING"; outcome: Judgement; note: string }) {
    await this.work.run(async (u) => {
      const [seen] = await u.tx.select().from(orders).where(eq(orders.id, orderId));
      if (!seen) throw notFound("order");
      if (seen.status !== b.expectedStatus) throw stateConflict(seen.status, b.expectedStatus);
      if (!seen.printerId) throw stateConflict(seen.status);
      const p = await this.locked(u, seen.printerId);
      const job = await this.activeJob(u, p);
      if (!job || job.orderId !== orderId) throw jobMismatch(job?.id ?? null);
      if (!(await this.has(u, p.id, "JUDGE"))) throw ruleViolation("this print is not waiting to be judged", { rule: "not_to_judge" });
      await this.judge(u, ctx, p, job, b.outcome, b.note);
    });
  }

  /**
   * Takes a printer out of "needs attention" by a person's decision: every reason except
   * "unreachable" is dropped (only a reconnection removes that one). If it still holds a job, the
   * person says what became of it. The printer then waits for the bed to be cleared.
   */
  async release(ctx: Ctx, printerId: string, b: { expectedJobId?: string | null; outcome?: Judgement | null; reason: string }) {
    await this.work.run(async (u) => {
      const p = await this.locked(u, printerId, "ATTENTION");
      const offline = await this.has(u, p.id, "OFFLINE");
      const s = offline ? undefined : (await this.views.live(p.id, u.tx))?.snapshot;
      /* While reachable and still running, it has to be stopped at the machine first. An unreachable one is released on the person's word. */
      if (s && RUNNING_STATES.has(s.state)) throw ruleViolation("the printer reports it is still running; stop it first", { rule: "still_running" });
      const job = await this.activeJob(u, p);
      if (job) {
        if (b.expectedJobId !== job.id) throw jobMismatch(job.id);
        if (!b.outcome) throw ruleViolation("say what became of the current job", { rule: "judgement_required" });
        await this.judge(u, ctx, p, job, b.outcome, b.reason);
      } else if (b.expectedJobId) throw jobMismatch(null);
      const before = await u.tx.select({ reason: printerReasons.reason }).from(printerReasons).where(eq(printerReasons.printerId, p.id));
      await u.tx.delete(printerReasons).where(and(eq(printerReasons.printerId, p.id), ne(printerReasons.reason, "OFFLINE")));
      if (!offline) await u.tx.update(printers).set({ externalRunning: false }).where(eq(printers.id, p.id));
      await settlePrinter(u, p.id);
      await this.audit.record(ctx, { action: "printer.release", targetType: "printer", targetId: p.id, reason: b.reason, before: { reasons: before.map((r) => r.reason) } }, u.tx);
    });
    return this.detail(ctx, printerId);
  }

  /** The one way a printer becomes available: someone confirms nothing is on the bed. A finished print still on it is handled by storing the order instead. */
  async confirmBedCleared(ctx: Ctx, printerId: string) {
    await this.work.run(async (u) => {
      const p = await this.locked(u, printerId, "CLEARING_REQUIRED");
      if (p.currentJobId) {
        const [waiting] = await u.tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.currentJobId, p.currentJobId), eq(orders.status, "PRINTED")));
        if (waiting) throw ruleViolation("the finished print is still to be stored; store the order instead", { rule: "store_first", orderId: waiting.id });
      }
      await u.tx.update(printers).set({ state: "AVAILABLE", stateSince: new Date(), currentJobId: null }).where(eq(printers.id, p.id));
      await settlePrinter(u, p.id);
      await this.audit.record(ctx, { action: "printer.bed_cleared", targetType: "printer", targetId: p.id }, u.tx);
      u.queue = true;
    });
    return this.detail(ctx, printerId);
  }

  /* ───────── commands ───────── */

  /**
   * Stop. With a system job the request names the job the person was looking at, so a late click
   * cannot stop the next order. Nothing changes here except that the request is on record: the
   * order moves when the printer reports it stopped.
   */
  async stop(ctx: Ctx, printerId: string, b: { expectedState: PrinterState; expectedJobId?: string; reason: string; reasonVisible?: boolean }) {
    return this.work.run(async (u) => {
      const p = await this.locked(u, printerId, b.expectedState);
      const job = await this.activeJob(u, p);
      if ((job?.id ?? null) !== (b.expectedJobId ?? null)) throw jobMismatch(job?.id ?? null);
      this.commands.requireOnline(p.daemonId);
      if (job) {
        await record(u, ctx, { orderId: job.orderId, kind: "print.stop_requested", jobId: job.id, note: b.reason, noteVisible: b.reasonVisible ?? true });
      } else {
        const s = (await this.views.live(p.id, u.tx))?.snapshot;
        if (!p.externalRunning && !(s && RUNNING_STATES.has(s.state))) throw ruleViolation("the printer is not running anything", { rule: "nothing_running" });
      }
      const c = await this.commands.enqueue(u, ctx, { daemonId: p.daemonId, printerId: p.id, jobId: job?.id ?? null, kind: "job.stop", params: job ? { jobRef: job.id } : { external: true } });
      await this.audit.record(ctx, { action: "printer.stop", targetType: "printer", targetId: p.id, reason: b.reason, after: { jobId: job?.id ?? null, commandId: c.id } }, u.tx);
      return { commandId: c.id, printerId: p.id };
    });
  }

  async skipParts(ctx: Ctx, orderId: string, b: { expectedJobId: string; partIds: number[] }) {
    return this.work.run(async (u) => {
      const [o] = await u.tx.select().from(orders).where(eq(orders.id, orderId));
      if (!o || (o.ownerId !== userIdOf(ctx) && !can(ctx, "order:skip-parts:any"))) throw notFound("order");
      if (o.status !== "PRINTING" || !o.printerId) throw stateConflict(o.status, "PRINTING");
      const p = await this.locked(u, o.printerId);
      const job = await this.activeJob(u, p);
      if (!job || job.id !== b.expectedJobId || job.orderId !== o.id) throw jobMismatch(job?.id ?? null);
      this.commands.requireOnline(p.daemonId);
      const c = await this.commands.enqueue(u, ctx, { daemonId: p.daemonId, printerId: p.id, jobId: job.id, kind: "job.skip_parts", params: { jobRef: job.id, partIds: [...new Set(b.partIds)] } });
      return { commandId: c.id, printerId: p.id };
    });
  }

  /** Read-only and device-control commands, passed on as they are; the adapter and the firmware decide what is possible. */
  async command(ctx: Ctx, printerId: string, kind: "refresh" | "control" | "error.resolve" | "storage.list", params: Record<string, unknown>) {
    return this.work.run(async (u) => {
      const p = await this.locked(u, printerId);
      if (p.disabledAt) throw stateConflict("DISABLED");
      this.commands.requireOnline(p.daemonId);
      let category: string | undefined;
      if (kind === "control") {
        const controls = (await this.views.live(p.id, u.tx))?.snapshot.controls;
        category = (Array.isArray(controls) ? (controls as { action: string; category: string }[]) : []).find((c) => c.action === params.action)?.category;
      }
      if (kind === "error.resolve") {
        const [e] = await u.tx
          .select()
          .from(printerErrors)
          .where(and(eq(printerErrors.printerId, p.id), eq(printerErrors.errorId, String(params.errorId)), isNull(printerErrors.clearedAt)));
        if (!e) throw notFound("error");
        /* Only the choices the printer itself offered for this error. */
        if (!(e.actions as { action: string }[]).some((a) => a.action === params.action)) throw ruleViolation("the printer does not offer that action for this error", { rule: "action_not_offered" });
      }
      const c = await this.commands.enqueue(u, ctx, { daemonId: p.daemonId, printerId: p.id, kind, params, category });
      if (kind === "error.resolve") await u.tx.update(printerErrors).set({ resolvedAction: String(params.action), resolvedBy: userIdOf(ctx), commandId: c.id }).where(and(eq(printerErrors.printerId, p.id), eq(printerErrors.errorId, String(params.errorId))));
      if (kind !== "refresh" && kind !== "storage.list") await this.audit.record(ctx, { action: `printer.${kind}`, targetType: "printer", targetId: p.id, after: { ...params, commandId: c.id } }, u.tx);
      return { commandId: c.id, printerId: p.id };
    });
  }
}
