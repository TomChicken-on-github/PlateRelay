import { HttpStatus } from "@nestjs/common";
import type { OrderStatus } from "@platerelay/shared";
import { eq } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Ctx } from "../auth/actor.js";
import { ApiError, notFound } from "../common/errors.js";
import type { Db } from "../db/db.js";
import { orderEvents, orders } from "../db/schema.js";

export type OrderRow = typeof orders.$inferSelect;
type OrderSet = Omit<PgUpdateSetSource<typeof orders>, "id" | "status">;

/**
 * Every allowed order transition. A transition not listed here cannot
 * happen, whoever asks. Who may ask is checked by the caller.
 */
export const TRANSITIONS = {
  approve: { from: ["PENDING_REVIEW"], to: "QUEUED" },
  reject: { from: ["PENDING_REVIEW"], to: "REJECTED" },
  dispatch: { from: ["QUEUED"], to: "PRINTING" },
  /** Dispatch did not take (file transfer failed before printing): back to the queue, same position. */
  requeue: { from: ["PRINTING"], to: "QUEUED" },
  finish: { from: ["PRINTING"], to: "PRINTED_AWAITING_STORAGE" },
  /** Only a handler stopping the print with a reason. An error pause alone never fails an order. */
  fail: { from: ["PRINTING"], to: "FAILED" },
  store: { from: ["PRINTED_AWAITING_STORAGE"], to: "STORED_READY_PICKUP" },
  redeem: { from: ["STORED_READY_PICKUP"], to: "COMPLETED" },
  /** A new file replaces the plate; it waits for re-review frozen in its place (rules doc §3). A PRINTING one was dispatched but not started and is recalled. */
  revise: { from: ["PENDING_REVIEW", "QUEUED", "PRINTING"], to: "PENDING_REVIEW" },
  /** Same, when 轻微修改自动审核 lets it skip the re-review. PENDING_REVIEW: replacing a revision still under review. */
  reviseApproved: { from: ["PENDING_REVIEW", "QUEUED", "PRINTING"], to: "QUEUED" },
  /** 恢复旧版本: an approved version comes back as a new one, approved already. */
  restore: { from: ["QUEUED", "PRINTING"], to: "QUEUED" },
  /** 撤回修改: the owner takes back a revision under review; the last approved version keeps its place. */
  withdraw: { from: ["PENDING_REVIEW"], to: "QUEUED" },
  /** A rejected revision: the last approved version keeps queueing in its place. */
  rejectRevision: { from: ["PENDING_REVIEW"], to: "QUEUED" },
  /* PRINTING only while the job is dispatched and not started; the service checks the printer */
  cancelOwn: { from: ["PENDING_REVIEW", "QUEUED", "PRINTING"], to: "CANCELLED" },
  cancelAny: { from: ["PENDING_REVIEW", "QUEUED", "PRINTING", "PRINTED_AWAITING_STORAGE", "STORED_READY_PICKUP"], to: "CANCELLED" },
} as const satisfies Record<string, { from: readonly OrderStatus[]; to: OrderStatus }>;

export type TransitionName = keyof typeof TRANSITIONS;

export interface TransitionOpts {
  set?: OrderSet;
  data?: Record<string, unknown>;
  /** Error code when the order is no longer in a `from` state; default order-state-conflict. */
  conflictCode?: string;
  conflictMessage?: string;
}

/**
 * Moves an order. The row is locked first (SELECT … FOR UPDATE), so two
 * people acting at once cannot both win: the second one sees the new status
 * and gets 409 with it. Writes the timeline event in the same transaction.
 */
export async function transition(tx: Db, ctx: Ctx, orderId: number, name: TransitionName, opts: TransitionOpts = {}): Promise<{ row: OrderRow; from: OrderStatus }> {
  const t = TRANSITIONS[name];
  const [cur] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)).for("update");
  if (!cur) throw notFound("订单");
  if (!(t.from as readonly OrderStatus[]).includes(cur.status)) {
    throw new ApiError(HttpStatus.CONFLICT, opts.conflictCode ?? "order-state-conflict", opts.conflictMessage ?? "订单状态已变化，请刷新后再试", {
      orderId,
      status: cur.status,
    });
  }
  const [row] = await tx.update(orders).set({ ...opts.set, status: t.to }).where(eq(orders.id, orderId)).returning();
  await tx.insert(orderEvents).values({
    orderId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.id ?? null,
    kind: name,
    fromStatus: cur.status,
    toStatus: t.to,
    data: opts.data ?? null,
  });
  return { row, from: cur.status };
}

/** Timeline entry that does not change the status (error pause, resume, reorder…). */
export async function orderEvent(tx: Db, ctx: Ctx, orderId: number, kind: string, data?: Record<string, unknown>) {
  await tx.insert(orderEvents).values({ orderId, actorType: ctx.actor.type, actorId: ctx.actor.id ?? null, kind, data: data ?? null });
}
