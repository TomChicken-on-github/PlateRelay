import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { QueueRules } from "@platerelay/shared";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, SYSTEM } from "../auth/actor.js";
import { ApiError } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { files, orders, orderVersions, printers } from "../db/schema.js";
import { inQueue, queueLock } from "../orders/queue.js";
import { orderRows, shownVersion } from "../orders/rows.js";
import { type OrderRow, transition } from "../orders/transition.js";
import { QUEUE_POLICY, type QueuePolicy } from "../rules/queue-policy.js";
import { SettingsService } from "../settings/settings.service.js";
import { type DispatchJobOptions, PRINTER_COMMANDS, type PrinterCommands } from "./commands.js";
import { hasWritableStorage } from "./compat.js";
import { lockPrinter, movePrinter } from "./printer-state.js";

/**
 * Global FIFO queue: each idle printer open to submitters is suggested the first queued order it is
 * compatible with, so incompatible orders get passed over (brief §0.6). Which one is the queue
 * policy's call. Nothing is sent on its own: Staff clear the bed and confirm the suggestion on site
 * (decided 2026-10-26, no automatic dispatch in the MVP). The panel decides; the daemon only executes.
 */
@Injectable()
export class SchedulerService {
  private readonly log = new Logger("Scheduler");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PRINTER_COMMANDS) private readonly commands: PrinterCommands,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Inject(QUEUE_POLICY) private readonly policy: QueuePolicy,
  ) {}

  /**
   * The suggested next order for every idle printer that can take one. Printers idle the longest
   * choose first, and an order is suggested to one printer only.
   */
  async suggestions(db: Db = this.db, rules?: QueueRules): Promise<Map<string, OrderRow>> {
    rules ??= await this.settings.get("queue.rules");
    const idle = (await db.select().from(printers).where(and(eq(printers.state, "IDLE"), eq(printers.openToContestants, true))).orderBy(asc(printers.stateSince), asc(printers.name))).filter(hasWritableStorage);
    const out = new Map<string, OrderRow>();
    if (!idle.length) return out;
    let queued = await orderRows(db, eq(orders.status, "QUEUED"), { orderBy: [asc(orders.queueSeq), asc(orders.id)] });
    for (const p of idle) {
      const o = this.policy.pick(rules, queued, p);
      if (!o) continue;
      out.set(p.id, o);
      queued = queued.filter((q) => q.id !== o.id);
    }
    return out;
  }

  /** Every queued order this printer could take now, in queue order: what Staff pick from when they dispatch. */
  async candidates(printerId: string, db: Db = this.db, rules?: QueueRules): Promise<OrderRow[]> {
    rules ??= await this.settings.get("queue.rules");
    const [p] = await db.select().from(printers).where(eq(printers.id, printerId));
    if (!p) return [];
    const queued = await db.select().from(orders).where(eq(orders.status, "QUEUED")).orderBy(asc(orders.queueSeq), asc(orders.id));
    return queued.filter((o) => this.policy.pick(rules, [o], p) === o);
  }

  /**
   * Staff dispatch: assigns an order to the printer and sends the job. The suggestion is only the
   * default; `orderId` may name any queued order the printer can take. Without it the current
   * suggestion is sent. Returns the order id, or null when the job could not be sent.
   */
  async dispatch(printerId: string, opts: { ctx?: Ctx; orderId?: number; job?: DispatchJobOptions } = {}): Promise<number | null> {
    const ctx = opts.ctx ?? SYSTEM;
    const rules = await this.settings.get("queue.rules");
    const picked = await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, printerId);
      if (p.state !== "IDLE" || !p.openToContestants || !hasWritableStorage(p)) {
        throw new ApiError(HttpStatus.CONFLICT, "printer-not-ready", "打印机现在不能接单", { printerId, state: p.state });
      }
      /* wait for any queue move or other confirmation in progress, then read the queue as it is after it */
      await queueLock(tx);
      await tx.select({ id: orders.id }).from(orders).where(eq(orders.status, "QUEUED")).for("update");
      const sug = await this.suggestions(tx, rules);
      let o = sug.get(p.id);
      if (opts.orderId != null) {
        o = (await this.candidates(p.id, tx, rules)).find((x) => x.id === opts.orderId);
        if (!o) throw new ApiError(HttpStatus.CONFLICT, "order-not-dispatchable", "这张单已经不在队列里，或这台打印机打不了", { printerId, orderId: opts.orderId });
      }
      if (!o) throw new ApiError(HttpStatus.CONFLICT, "no-suggestion", "队列里没有这台打印机能打的订单", { printerId });
      const now = new Date();
      await transition(tx, ctx, o.id, "dispatch", { set: { printerId: p.id, startedAt: now, skippedSince: null }, data: { printer: p.name } });
      /* everything still queued ahead of it has just been passed over (跳单), except what another idle printer is suggested */
      const others = [...sug.entries()].filter(([pid, x]) => pid !== p.id && x.id !== o.id).map(([, x]) => x.id);
      await tx
        .update(orders)
        .set({ skippedSince: now })
        .where(and(eq(orders.status, "QUEUED"), isNull(orders.skippedSince), sql`(${orders.queueSeq}, ${orders.id}) < (${o.queueSeq}, ${o.id})`, others.length ? notInArray(orders.id, others) : undefined));
      await movePrinter(tx, p, "dispatch", { currentOrderId: o.id, error: null });
      await this.audit.record(ctx, { action: "order.dispatch", targetType: "order", targetId: o.id, after: { printerId: p.id } }, tx);
      const [f] = await tx.select({ key: files.key, sha256: files.sha256 }).from(files).where(eq(files.id, o.fileId));
      return { order: o, file: f };
    });
    try {
      await this.commands.startJob(printerId, { orderId: picked.order.id, plateIndex: picked.order.plateIndex, fileKey: picked.file.key, sha256: picked.file.sha256, ...opts.job });
    } catch (e) {
      this.log.warn(`job for order ${picked.order.id} not sent: ${(e as Error).message}; back to the queue`);
      await this.db.transaction(async (tx) => {
        const p = await lockPrinter(tx, printerId);
        await transition(tx, SYSTEM, picked.order.id, "requeue", { set: { printerId: null, startedAt: null }, data: { why: "send-failed" } });
        if (p.currentOrderId === picked.order.id) await movePrinter(tx, p, "prepareFailed", { currentOrderId: null });
        await this.audit.record(SYSTEM, { action: "order.dispatch.failed", targetType: "order", targetId: picked.order.id, before: { status: "PRINTING", printerId }, after: { status: "QUEUED", printerId: null }, result: "failed", reason: "send-failed" }, tx);
      });
      return null;
    }
    return picked.order.id;
  }

  /** Position (1-based) and estimated print time ahead, for every order in the queue, frozen revisions included. */
  async queuePositions(db: Db = this.db): Promise<Map<number, { position: number; aheadSeconds: number }>> {
    const q = await db
      .select({ id: orders.id, s: orderVersions.printSeconds })
      .from(orders)
      .innerJoin(orderVersions, shownVersion)
      .where(inQueue)
      .orderBy(asc(orders.queueSeq), asc(orders.id));
    const out = new Map<number, { position: number; aheadSeconds: number }>();
    let ahead = 0;
    q.forEach((o, i) => {
      out.set(o.id, { position: i + 1, aheadSeconds: ahead });
      ahead += o.s;
    });
    return out;
  }
}
