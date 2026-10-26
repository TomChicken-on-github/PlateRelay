import { and, asc, eq, isNotNull, or } from "drizzle-orm";
import type { Db } from "../db/db.js";
import { orders } from "../db/schema.js";

/**
 * The queue is every order holding a FIFO key that has not left it: QUEUED ones, plus revisions
 * waiting for re-review, which stay frozen in their place (rules doc §3.2) and are skipped by dispatch.
 */
export const inQueue = or(eq(orders.status, "QUEUED"), and(eq(orders.status, "PENDING_REVIEW"), isNotNull(orders.queueSeq)));

export type QueueMember = { id: number; seq: number };

/** The queue in order, rows locked. */
export async function lockQueue(tx: Db): Promise<QueueMember[]> {
  const q = await tx.select({ id: orders.id, seq: orders.queueSeq }).from(orders).where(inQueue).orderBy(asc(orders.queueSeq), asc(orders.id)).for("update");
  return q.map((o) => ({ id: o.id, seq: o.seq! }));
}

/**
 * Moves one order to a 0-based place, reusing the same keys in the new order so later approvals
 * still land at the end. Returns the place it ended up at.
 */
export async function moveInQueue(tx: Db, q: QueueMember[], id: number, to: number): Promise<number> {
  const from = q.findIndex((o) => o.id === id);
  const target = Math.min(Math.max(to, 0), q.length - 1);
  if (from < 0 || target === from) return from;
  const seqs = q.map((o) => o.seq).sort((a, b) => a - b);
  const ids = q.map((o) => o.id);
  ids.splice(target, 0, ...ids.splice(from, 1));
  for (let i = 0; i < ids.length; i++) if (q[i].id !== ids[i] || q[i].seq !== seqs[i]) await tx.update(orders).set({ queueSeq: seqs[i] }).where(eq(orders.id, ids[i]));
  return target;
}
