import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { SYSTEM } from "../auth/actor.js";
import { DB, type Db } from "../db/db.js";
import { files, orders, printers } from "../db/schema.js";
import { inQueue } from "../orders/queue.js";
import { transition } from "../orders/transition.js";
import { QUEUE_POLICY, type QueuePolicy } from "../rules/queue-policy.js";
import { SettingsService } from "../settings/settings.service.js";
import { PRINTER_COMMANDS, type PrinterCommands } from "./commands.js";
import { hasWritableStorage } from "./compat.js";
import { lockPrinter, movePrinter } from "./printer-state.js";

/**
 * Global FIFO queue: an idle printer open to submitters takes the first
 * queued order it is compatible with, so incompatible orders get passed
 * over (brief §0.6). Which one is the queue policy's call. The panel
 * decides; the daemon only executes.
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

  /** Tries every idle, reachable printer. Call after anything that frees a printer or queues an order. */
  async kick(): Promise<void> {
    try {
      const idle = await this.db.select({ id: printers.id }).from(printers).where(and(eq(printers.state, "IDLE"), eq(printers.openToContestants, true)));
      for (const p of idle) if (this.commands.reachable(p.id)) await this.dispatch(p.id);
    } catch (e) {
      /* never fails the request that triggered it; the next kick tries again */
      this.log.error(`dispatch failed: ${(e as Error).message}`);
    }
  }

  /** Assigns the first compatible queued order to the printer and sends the job. Returns the order id. */
  async dispatch(printerId: string): Promise<number | null> {
    const rules = await this.settings.get("queue.rules");
    const picked = await this.db.transaction(async (tx) => {
      const p = await lockPrinter(tx, printerId);
      if (p.state !== "IDLE" || !p.openToContestants || !hasWritableStorage(p)) return null;
      const queued = await tx
        .select()
        .from(orders)
        .where(eq(orders.status, "QUEUED"))
        .orderBy(asc(orders.queueSeq), asc(orders.id))
        .for("update", { skipLocked: true });
      const o = this.policy.pick(rules, queued, p);
      if (!o) return null;
      const now = new Date();
      await transition(tx, SYSTEM, o.id, "dispatch", { set: { printerId: p.id, startedAt: now, skippedSince: null }, data: { printer: p.name } });
      /* everything still queued ahead of it has just been passed over (跳单) */
      await tx
        .update(orders)
        .set({ skippedSince: now })
        .where(and(eq(orders.status, "QUEUED"), isNull(orders.skippedSince), sql`(${orders.queueSeq}, ${orders.id}) < (${o.queueSeq}, ${o.id})`));
      await movePrinter(tx, p, "dispatch", { currentOrderId: o.id, error: null });
      await this.audit.record(SYSTEM, { action: "order.dispatch", targetType: "order", targetId: o.id, after: { printerId: p.id } }, tx);
      const [f] = await tx.select({ key: files.key, sha256: files.sha256 }).from(files).where(eq(files.id, o.fileId));
      return { order: o, file: f };
    });
    if (!picked) return null;
    try {
      await this.commands.startJob(printerId, { orderId: picked.order.id, plateIndex: picked.order.plateIndex, fileKey: picked.file.key, sha256: picked.file.sha256 });
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
      .select({ id: orders.id, s: orders.printSeconds })
      .from(orders)
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
