import { and, asc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import type { Uow } from "../core/uow.js";
import { orders } from "../db/schema.js";

/*
 * The queue is ordered by a stored number, never recomputed from submission time. An order gets
 * its number at the first approval and keeps it when it leaves the queue, which is what lets a
 * reprint or a stop before the start return to the same place. Orders whose revision awaits review
 * keep their place too (frozen): they cannot be dispatched but still count as a place.
 */

/** Room between neighbours, so moving one order rarely has to renumber the rest. */
const GAP = 1n << 20n;

/** Every change of queue order runs under this lock, so two of them cannot hand out colliding places. */
export async function lockQueue(u: Uow) {
  await u.tx.execute(sql`select pg_advisory_xact_lock(7001)`);
}

/** Orders holding a place: queued ones and frozen ones. */
const IN_QUEUE = and(isNotNull(orders.sortKey), inArray(orders.status, ["QUEUED", "PENDING_REVIEW"]));

export async function queueOrder(u: Uow) {
  return u.tx.select({ id: orders.id, sortKey: orders.sortKey, status: orders.status }).from(orders).where(IN_QUEUE).orderBy(asc(orders.sortKey), asc(orders.id));
}

/** A number behind everything that ever had one, so a place given once is never given again. */
export async function tailKey(u: Uow): Promise<bigint> {
  const [{ max }] = await u.tx.select({ max: sql<string | null>`max(${orders.sortKey})` }).from(orders);
  return (max === null ? 0n : BigInt(max)) + GAP;
}

/** Puts an order right behind another (null = at the front). Returns its new number. */
export async function placeAfter(u: Uow, orderId: string, afterId: string | null): Promise<bigint> {
  let queue = (await queueOrder(u)).filter((o) => o.id !== orderId);
  const at = afterId === null ? -1 : queue.findIndex((o) => o.id === afterId);
  if (afterId !== null && at < 0) throw new Error("the order to place after is not in the queue");
  let before = at < 0 ? null : queue[at].sortKey!;
  let next = queue[at + 1]?.sortKey ?? null;
  if (before !== null && next !== null && next - before < 2n) {
    /* No room left between the two: renumber everything. Only the numbers change, not the order. */
    let k = 0n;
    for (const o of queue) await u.tx.update(orders).set({ sortKey: (k += GAP) }).where(eq(orders.id, o.id));
    queue = (await queueOrder(u)).filter((o) => o.id !== orderId);
    before = queue[at].sortKey!;
    next = queue[at + 1]?.sortKey ?? null;
  }
  const key = before === null ? (next === null ? GAP : next - GAP) : next === null ? await tailKey(u) : (before + next) / 2n;
  await u.tx.update(orders).set({ sortKey: key }).where(eq(orders.id, orderId));
  u.queue = true;
  return key;
}

/**
 * Moves an order back n places: counts n orders with a place behind it (frozen ones included) and
 * goes behind them; with fewer than n it goes to the end. n = -1 means straight to the end.
 */
export async function moveBack(u: Uow, orderId: string, sortKey: bigint, n: number): Promise<void> {
  if (n === 0) return;
  const behind = await u.tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(IN_QUEUE, gt(orders.sortKey, sortKey)))
    .orderBy(asc(orders.sortKey), asc(orders.id));
  const others = behind.filter((o) => o.id !== orderId);
  if (!others.length) return;
  if (n < 0 || n >= others.length) {
    await u.tx
      .update(orders)
      .set({ sortKey: await tailKey(u) })
      .where(eq(orders.id, orderId));
    u.queue = true;
  } else await placeAfter(u, orderId, others[n - 1].id);
}

/**
 * How far a revision moves its order back, from how much longer it prints than the last approved
 * version. Up to the threshold it stays; beyond it, one step of places for every started step of
 * minutes. A shorter print never moves forward. Each revision is judged on its own.
 */
export function placesBackFor(deltaSeconds: number, r: { thresholdMinutes: number; beyondThreshold: string; placesPerStep: number; minutesPerStep: number }): number {
  const over = deltaSeconds - r.thresholdMinutes * 60;
  if (over <= 0 || r.beyondThreshold !== "STEP_BACK") return 0;
  return Math.ceil(over / (r.minutesPerStep * 60)) * r.placesPerStep;
}
