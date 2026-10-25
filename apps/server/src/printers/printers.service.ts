import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { DaemonAccessCode, EncryptedAccessCode, OrderView, PrinterView, TodoView } from "@platerelay/shared";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, can, SYSTEM, userId } from "../auth/actor.js";
import { ApiError, notFound } from "../common/errors.js";
import { modulusBytes } from "../daemons/daemons.service.js";
import { DB, type Db } from "../db/db.js";
import { daemons, files, orders, type PrinterError, printers } from "../db/schema.js";
import { OrdersService } from "../orders/orders.service.js";
import { orderEvent, transition } from "../orders/transition.js";
import { loadPeople } from "../orders/views.js";
import { PRINTER_COMMANDS, type PrinterCommands, PrinterUnreachable } from "./commands.js";
import { lockPrinter, movePrinter, pausedMs, type PrinterRow } from "./printer-state.js";
import { SchedulerService } from "./scheduler.service.js";

export interface PrinterInput {
  name: string;
  ip: string;
  serial: string;
  daemonId?: string | null;
  /** Encrypted in the browser with the daemon's key; null removes the stored code, absent keeps it. */
  accessCode?: EncryptedAccessCode | null;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Actions that resume or dismiss an error without ending the print (driver draft §6). */
const RESUME_ACTIONS = ["RESUME", "RESUME_ACCEPT_DEFECTS", "RESUME_PROBLEM_SOLVED", "RETRY", "CONFIRM_DONE", "IGNORE", "ACKNOWLEDGE"];

@Injectable()
export class PrintersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PRINTER_COMMANDS) private readonly commands: PrinterCommands,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerService,
    private readonly orders: OrdersService,
  ) {}

  /* ---------- reading ---------- */

  async views(ctx: Ctx, rows: PrinterRow[]): Promise<PrinterView[]> {
    const ids = rows.map((p) => p.currentOrderId).filter((x): x is number => x != null);
    const jobs = ids.length
      ? await this.db
          .select({ id: orders.id, ownerId: orders.ownerId, status: orders.status, plateIndex: orders.plateIndex, plateCount: orders.plateCount, fileName: files.fileName })
          .from(orders)
          .innerJoin(files, eq(files.id, orders.fileId))
          .where(inArray(orders.id, ids))
      : [];
    const jobMap = new Map(jobs.map((j) => [j.id, j]));
    const people = await loadPeople(this.db, jobs.map((j) => j.ownerId));
    const manage = can(ctx, "printer:manage");
    const operate = can(ctx, "printer:operate");
    const daemonIds = [...new Set(rows.map((p) => p.daemonId).filter((x): x is string => !!x))];
    const keyOf = new Map(manage && daemonIds.length ? (await this.db.select({ id: daemons.id, keyId: daemons.keyId }).from(daemons).where(inArray(daemons.id, daemonIds))).map((d) => [d.id, d.keyId]) : []);
    return rows.map((p) => {
      const j = p.currentOrderId != null ? jobMap.get(p.currentOrderId) : undefined;
      return {
        id: p.id,
        name: p.name,
        /* network details only for people who manage printers */
        serial: manage ? p.serial : null,
        ip: manage ? p.ip : null,
        daemonId: manage ? p.daemonId : null,
        /* whether a code is stored, never the code or its ciphertext */
        accessCode:
          manage && p.accessCodeCipher && p.accessCodeSetAt
            ? { setAt: p.accessCodeSetAt.toISOString(), delivered: !!p.accessCodeDeliveredAt, current: !!p.daemonId && keyOf.get(p.daemonId) === p.accessCodeKeyId }
            : null,
        model: p.model,
        modelId: p.modelId,
        nozzles: p.nozzles,
        storage: p.storage,
        telemetry: p.telemetry,
        state: p.state,
        stateSince: p.stateSince.toISOString(),
        error: operate ? p.error : null,
        maintenanceReason: p.maintenanceReason,
        starred: p.starred,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        job: j ? { orderId: j.id, fileName: j.fileName, plate: { index: j.plateIndex, count: j.plateCount }, owner: people.owner(ctx, j.ownerId), status: j.status } : null,
      };
    });
  }

  async list(ctx: Ctx) {
    return this.views(ctx, await this.db.select().from(printers).orderBy(asc(printers.name)));
  }

  async get(ctx: Ctx, id: string) {
    const [p] = await this.db.select().from(printers).where(eq(printers.id, id));
    if (!p) throw notFound("打印机");
    return (await this.views(ctx, [p]))[0];
  }

  /* ---------- management ---------- */

  /** Model and nozzles are not taken here: the printer reports them through its daemon. */
  async create(ctx: Ctx, input: PrinterInput) {
    /* views read outside the transaction: PGlite has one connection and the transaction holds it */
    const p = await this.db.transaction(async (tx) => {
      await this.assertUnique(tx, input);
      const daemonId = input.daemonId ?? null;
      const code = await this.accessCodeColumns(tx, daemonId, input.accessCode);
      const [p] = await tx.insert(printers).values({ name: input.name, ip: input.ip, serial: input.serial, daemonId, ...code }).returning();
      await this.audit.record(ctx, { action: "printer.create", targetType: "printer", targetId: p.id, after: { name: p.name, ip: p.ip, serial: p.serial, daemonId, accessCode: p.accessCodeCipher ? "set" : null } }, tx);
      return p;
    });
    return (await this.views(ctx, [p]))[0];
  }

  async update(ctx: Ctx, id: string, input: Partial<PrinterInput>) {
    const n = await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      await this.assertUnique(tx, input, id);
      const { accessCode, ...fields } = input;
      const daemonId = fields.daemonId === undefined ? p.daemonId : fields.daemonId;
      /* the code is encrypted for one daemon and bound to one serial, so moving either drops it */
      const moved = daemonId !== p.daemonId || (fields.serial !== undefined && fields.serial !== p.serial);
      const code = accessCode !== undefined ? await this.accessCodeColumns(tx, daemonId, accessCode) : moved ? await this.accessCodeColumns(tx, daemonId, null) : {};
      const [n] = await tx.update(printers).set({ ...fields, ...code }).where(eq(printers.id, id)).returning();
      const codeChange = accessCode ? "set" : (accessCode === null || moved) && p.accessCodeCipher ? "cleared" : undefined;
      await this.audit.record(
        ctx,
        { action: "printer.update", targetType: "printer", targetId: id, before: { name: p.name, ip: p.ip, serial: p.serial, daemonId: p.daemonId }, after: { ...fields, ...(codeChange ? { accessCode: codeChange } : {}) } },
        tx,
      );
      return n;
    });
    return (await this.views(ctx, [n]))[0];
  }

  /** Checks an encrypted code against the daemon's current key and returns the columns to write. */
  private async accessCodeColumns(tx: Db, daemonId: string | null, code: EncryptedAccessCode | null | undefined) {
    const d = daemonId ? (await tx.select().from(daemons).where(eq(daemons.id, daemonId)))[0] : undefined;
    if (daemonId && !d) throw new ApiError(HttpStatus.BAD_REQUEST, "daemon-not-found", "选择的 daemon 不存在");
    if (!code) return { accessCodeCipher: null, accessCodeKeyId: null, accessCodeSetAt: null, accessCodeDeliveredAt: null };
    if (!d) throw new ApiError(HttpStatus.BAD_REQUEST, "daemon-required", "先选择负责这台打印机的 daemon，访问码要用它的公钥加密");
    if (!d.publicKey || d.keyId !== code.keyId)
      throw new ApiError(HttpStatus.CONFLICT, "daemon-key-changed", d.publicKey ? "daemon 的公钥已经换了，请刷新后重新输入访问码" : "这个 daemon 还没连上面板，连上后才能设置访问码", { daemonId: d.id, keyId: d.keyId });
    if (!B64.test(code.ciphertext) || Buffer.from(code.ciphertext, "base64").length !== modulusBytes(d.publicKey))
      throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-access-code", "访问码密文格式不对");
    return { accessCodeCipher: code.ciphertext, accessCodeKeyId: code.keyId, accessCodeSetAt: new Date(), accessCodeDeliveredAt: null };
  }

  /* ---------- daemon link (not wired yet: the daemon protocol is not built) ---------- */

  /** Codes the daemon can decrypt: its printers whose code was encrypted with its current key. */
  async accessCodesFor(daemonId: string): Promise<DaemonAccessCode[]> {
    const rows = await this.db
      .select({ printerId: printers.id, serial: printers.serial, ip: printers.ip, keyId: printers.accessCodeKeyId, ciphertext: printers.accessCodeCipher })
      .from(printers)
      .innerJoin(daemons, eq(daemons.id, printers.daemonId))
      .where(and(eq(printers.daemonId, daemonId), eq(daemons.enabled, true), isNotNull(printers.accessCodeCipher), eq(printers.accessCodeKeyId, daemons.keyId)));
    return rows.map((r) => ({ ...r, keyId: r.keyId!, ciphertext: r.ciphertext! }));
  }

  /** The daemon confirms it decrypted and stored the code; shown as 已送达 in 打印机管理. */
  async markAccessCodeDelivered(daemonId: string, printerId: string) {
    await this.db
      .update(printers)
      .set({ accessCodeDeliveredAt: new Date() })
      .where(and(eq(printers.id, printerId), eq(printers.daemonId, daemonId), isNotNull(printers.accessCodeCipher)));
  }

  private async assertUnique(tx: Db, input: Partial<PrinterInput>, self?: string) {
    for (const [col, v, msg] of [[printers.name, input.name, "名称"], [printers.serial, input.serial, "序列号"]] as const) {
      if (!v) continue;
      const [hit] = await tx.select({ id: printers.id }).from(printers).where(eq(col, v));
      if (hit && hit.id !== self) throw new ApiError(HttpStatus.CONFLICT, "printer-duplicate", `已有相同${msg}的打印机`);
    }
  }

  async remove(ctx: Ctx, id: string) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      if (p.currentOrderId != null) throw new ApiError(HttpStatus.CONFLICT, "printer-busy", "打印机上还有订单，处理完再删除", { printerId: id, orderId: p.currentOrderId });
      await tx.delete(printers).where(eq(printers.id, id));
      await this.audit.record(ctx, { action: "printer.delete", targetType: "printer", targetId: id, before: { name: p.name, serial: p.serial } }, tx);
    });
  }

  /** 下线维护 / 恢复上线. Only an idle or offline printer can go into maintenance. */
  async maintenance(ctx: Ctx, id: string, on: boolean, reason: string | null) {
    const p = await this.db.transaction(async (tx) => {
      const cur = await lockPrinter(tx, id);
      const next = on ? await movePrinter(tx, cur, "maintenanceOn", { maintenanceReason: reason }) : await movePrinter(tx, cur, "maintenanceOff", { maintenanceReason: null });
      await this.audit.record(ctx, { action: on ? "printer.maintenance.on" : "printer.maintenance.off", targetType: "printer", targetId: id, before: { state: cur.state }, after: { state: next.state }, reason }, tx);
      return next;
    });
    if (!on) void this.scheduler.kick();
    return (await this.views(ctx, [p]))[0];
  }

  async star(ctx: Ctx, id: string, starred: boolean) {
    const p = await this.db.transaction(async (tx) => {
      const cur = await lockPrinter(tx, id);
      const [next] = await tx.update(printers).set({ starred }).where(eq(printers.id, id)).returning();
      await this.audit.record(ctx, { action: "printer.star", targetType: "printer", targetId: id, before: { starred: cur.starred }, after: { starred } }, tx);
      return next;
    });
    return (await this.views(ctx, [p]))[0];
  }

  /* ---------- handling ---------- */

  /**
   * Resolves the printer's current error with one of its allowed actions.
   * STOP ends the print: the order fails with the reason given and the
   * printer needs its bed cleared. Other actions go to the printer and the
   * print carries on; the order never left PRINTING.
   */
  async resolve(ctx: Ctx, id: string, action: string, reason: string | null) {
    if (action === "STOP") return this.stop(ctx, id, reason);
    const [cur] = await this.db.select().from(printers).where(eq(printers.id, id));
    if (!cur) throw notFound("打印机");
    if (cur.state !== "ERROR_PAUSED") throw new ApiError(HttpStatus.CONFLICT, "printer-state-conflict", "打印机当前没有待处理的报错", { printerId: id, state: cur.state });
    const allowed = cur.error?.actions?.length ? cur.error.actions : RESUME_ACTIONS;
    if (!allowed.includes(action) || !RESUME_ACTIONS.includes(action)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, "action-not-allowed", "这条报错不支持这个操作", { allowed: [...allowed, "STOP"] });
    }
    try {
      await this.commands.resolveError(id, action, cur.error?.errorId ?? null);
    } catch (e) {
      await this.audit.record(ctx, { action: "printer.error.resolve", targetType: "printer", targetId: id, after: { action, errorId: cur.error?.errorId ?? null }, result: "failed", reason: e instanceof PrinterUnreachable ? "printer-unreachable" : "command-failed" });
      if (e instanceof PrinterUnreachable) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, "printer-unreachable", "连不上这台打印机的 daemon，请在打印机屏幕上处理");
      throw e;
    }
    await this.audit.record(ctx, { action: "printer.error.resolve", targetType: "printer", targetId: id, after: { action, errorId: cur.error?.errorId ?? null } });
    /* the printer's own report (onResumed) moves it back to PRINTING */
    return this.get(ctx, id);
  }

  /** Stops the print on a handler's decision; the order becomes FAILED. */
  async stop(ctx: Ctx, id: string, reason: string | null) {
    if (!reason?.trim()) throw new ApiError(HttpStatus.BAD_REQUEST, "reason-required", "停止打印要选失败原因");
    const orderId = await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      if (!["PREPARING", "PRINTING", "ERROR_PAUSED"].includes(p.state) || p.currentOrderId == null) {
        throw new ApiError(HttpStatus.CONFLICT, "printer-state-conflict", "打印机当前没有在打印", { printerId: id, state: p.state });
      }
      const now = new Date();
      const [o] = await tx.select({ ms: orders.errorPausedMs }).from(orders).where(eq(orders.id, p.currentOrderId));
      await transition(tx, ctx, p.currentOrderId, "fail", {
        set: { failedBy: userId(ctx), failedAt: now, failureReason: reason, errorPausedMs: (o?.ms ?? 0) + pausedMs(p, now) },
        data: { reason, error: p.error?.vendorCode ?? null },
      });
      await movePrinter(tx, p, "stopped", { error: null });
      await this.audit.record(ctx, { action: "printer.stop", targetType: "printer", targetId: id, after: { orderId: p.currentOrderId, status: "FAILED" }, reason }, tx);
      return p.currentOrderId;
    });
    const commandSent = await this.orders.sendStop(ctx, id);
    return { printer: await this.get(ctx, id), orderId, commandSent };
  }

  /** Confirms a clean bed when there is nothing to store (failed, cancelled or external job). */
  async clearBed(ctx: Ctx, id: string) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      if (p.currentOrderId != null) {
        const [o] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, p.currentOrderId));
        if (o?.status === "PRINTED_AWAITING_STORAGE") {
          throw new ApiError(HttpStatus.CONFLICT, "store-first", "这台打印机上的成品要先铲件入库", { printerId: id, orderId: p.currentOrderId });
        }
      }
      await movePrinter(tx, p, "cleared", { currentOrderId: null });
      await this.audit.record(ctx, { action: "printer.clear-bed", targetType: "printer", targetId: id, before: { orderId: p.currentOrderId } }, tx);
    });
    void this.scheduler.kick();
    return this.get(ctx, id);
  }

  /** 待办: plates to store, beds to clear, errors to handle. */
  async todo(ctx: Ctx): Promise<TodoView> {
    const busy = await this.db.select().from(printers).where(inArray(printers.state, ["CLEARING_REQUIRED", "ERROR_PAUSED"])).orderBy(asc(printers.stateSince));
    const awaiting = await this.db.select().from(orders).where(eq(orders.status, "PRINTED_AWAITING_STORAGE")).orderBy(asc(orders.printedAt));
    const onBeds = busy.map((p) => p.currentOrderId).filter((x): x is number => x != null);
    const bedOrders = onBeds.length ? await this.db.select().from(orders).where(inArray(orders.id, onBeds)) : [];
    const views = new Map<number, OrderView>((await this.orders.views(ctx, [...awaiting, ...bedOrders.filter((o) => o.status !== "PRINTED_AWAITING_STORAGE")])).map((v) => [v.id, v]));
    const pViews = new Map((await this.views(ctx, busy)).map((p) => [p.id, p]));
    const awaitingIds = new Set(awaiting.map((o) => o.id));
    return {
      store: awaiting.map((o) => ({ order: views.get(o.id)!, printer: o.printerId ? (pViews.get(o.printerId) ?? null) : null, since: o.printedAt?.toISOString() ?? null })),
      clear: busy
        .filter((p) => p.state === "CLEARING_REQUIRED" && !(p.currentOrderId != null && awaitingIds.has(p.currentOrderId)))
        .map((p) => ({ printer: pViews.get(p.id)!, order: p.currentOrderId != null ? (views.get(p.currentOrderId) ?? null) : null, since: p.stateSince.toISOString() })),
      errors: busy
        .filter((p) => p.state === "ERROR_PAUSED")
        .map((p) => ({ printer: pViews.get(p.id)!, order: p.currentOrderId != null ? (views.get(p.currentOrderId) ?? null) : null, since: p.stateSince.toISOString() })),
    };
  }

  /* ---------- what the printer reports (called by the daemon link) ---------- */

  async onStarted(id: string, ctx: Ctx = { ...SYSTEM, actor: { type: "printer", id } }) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      await movePrinter(tx, p, "started");
      if (p.currentOrderId != null) await orderEvent(tx, ctx, p.currentOrderId, "printing-started");
      await this.audit.record(ctx, { action: "printer.started", targetType: "printer", targetId: id, before: { state: p.state }, after: { state: "PRINTING", orderId: p.currentOrderId } }, tx);
    });
  }

  /** An error pause: the order stays PRINTING; staff see the details, everyone else sees 等待处理. */
  async onErrorPaused(id: string, error: PrinterError, ctx: Ctx = { ...SYSTEM, actor: { type: "printer", id } }) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      await movePrinter(tx, p, "errorPaused", { error });
      if (p.currentOrderId != null) await orderEvent(tx, ctx, p.currentOrderId, "error-paused", { vendorCode: error.vendorCode, message: error.message ?? null });
      await this.audit.record(ctx, { action: "printer.error", targetType: "printer", targetId: id, after: { vendorCode: error.vendorCode, orderId: p.currentOrderId } }, tx);
    });
  }

  /** Resumed, from the panel or on the printer's own screen; the pause counts into the order's time. */
  async onResumed(id: string, ctx: Ctx = { ...SYSTEM, actor: { type: "printer", id } }) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      const ms = pausedMs(p);
      await movePrinter(tx, p, "resumed", { error: null });
      if (p.currentOrderId != null) {
        const [o] = await tx.select({ ms: orders.errorPausedMs }).from(orders).where(eq(orders.id, p.currentOrderId));
        await tx.update(orders).set({ errorPausedMs: (o?.ms ?? 0) + ms }).where(eq(orders.id, p.currentOrderId));
        await orderEvent(tx, ctx, p.currentOrderId, "resumed", { pausedMs: ms });
      }
      await this.audit.record(ctx, { action: "printer.resumed", targetType: "printer", targetId: id, after: { pausedMs: ms } }, tx);
    });
  }

  /** Printed: the plate waits on the bed for 铲件入库; the printer is not released until then. */
  async onFinished(id: string, ctx: Ctx = { ...SYSTEM, actor: { type: "printer", id } }) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      if (p.currentOrderId == null) throw new ApiError(HttpStatus.CONFLICT, "printer-state-conflict", "打印机上没有订单", { printerId: id });
      await transition(tx, ctx, p.currentOrderId, "finish", { set: { printedAt: new Date() } });
      await movePrinter(tx, p, "finished");
      await this.audit.record(ctx, { action: "printer.finished", targetType: "printer", targetId: id, before: { state: p.state }, after: { state: "CLEARING_REQUIRED", orderId: p.currentOrderId } }, tx);
    });
  }

  /** The job never got going (file transfer or preheat failed): bed is clean, order goes back to its place. */
  async onPrepareFailed(id: string, why: string, ctx: Ctx = { ...SYSTEM, actor: { type: "printer", id } }) {
    await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, id);
      if (p.currentOrderId != null) await transition(tx, ctx, p.currentOrderId, "requeue", { set: { printerId: null, startedAt: null }, data: { why } });
      await movePrinter(tx, p, "prepareFailed", { currentOrderId: null });
      await this.audit.record(ctx, { action: "printer.prepare-failed", targetType: "printer", targetId: id, after: { orderId: p.currentOrderId }, reason: why }, tx);
    });
  }
}

