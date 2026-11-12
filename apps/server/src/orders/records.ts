import { actorColumns, type Ctx } from "../common/ctx.js";
import type { Uow } from "../core/uow.js";
import { orderRecords, type orders } from "../db/schema.js";

export type OrderStatus = (typeof orders.$inferSelect)["status"];
export type OrderRow = typeof orders.$inferSelect;
type Node = (typeof orderRecords.$inferInsert)["node"];

/*
 * Every record type the timeline knows, with the step of the process it is filed under. The front
 * end has a text for each. Notes are visible to the applicant or not per record; the default
 * depends on the action and is decided by the caller.
 */
export const RECORD_NODE = {
  "order.submitted": "SUBMIT",
  "order.approved": "REVIEW",
  "order.rejected": "REVIEW",
  "version.replaced": "REVIEW",
  "version.revised": "REVIEW",
  "version.approved": "REVIEW",
  "version.rejected": "REVIEW",
  "version.withdrawn": "REVIEW",
  "version.restored": "REVIEW",
  "queue.entered": "QUEUE",
  "queue.moved_back": "QUEUE",
  "dispatch.created": "QUEUE",
  "dispatch.stopped_before_start": "QUEUE",
  "dispatch.send_failed": "QUEUE",
  "dispatch.start_failed": "QUEUE",
  "order.reprinted": "QUEUE",
  "print.started": "PRINT",
  "print.paused": "PRINT",
  "print.resumed": "PRINT",
  "print.stop_requested": "PRINT",
  "print.stopped": "PRINT",
  "print.stopped_on_device": "PRINT",
  "print.failed": "PRINT",
  "print.finished": "PRINT",
  "print.judged": "PRINT",
  "parts.skipped": "PRINT",
  "reprint.declined": "PRINT",
  "reprint.decline_revoked": "PRINT",
  "note.added": "PRINT",
  "order.stored": "STORE",
  "pickup.code_issued": "PICKUP",
  "order.redeemed": "PICKUP",
  "order.disposed": "PICKUP",
  /* A cancellation is filed under the step the order was at; see cancelNode(). */
  "order.cancelled": "REVIEW",
} as const satisfies Record<string, Node>;

export type RecordKind = keyof typeof RECORD_NODE;

export interface RecordInput {
  orderId: string;
  kind: RecordKind;
  node?: Node;
  from?: OrderStatus | null;
  to?: OrderStatus | null;
  versionN?: number | null;
  jobId?: string | null;
  note?: string | null;
  noteVisible?: boolean;
  data?: Record<string, unknown>;
}

/** Appends one line to an order's timeline. */
export async function record(u: Uow, ctx: Ctx, r: RecordInput) {
  await u.tx.insert(orderRecords).values({
    orderId: r.orderId,
    node: r.node ?? RECORD_NODE[r.kind],
    kind: r.kind,
    ...actorColumns(ctx),
    fromStatus: r.from ?? null,
    toStatus: r.to ?? null,
    versionN: r.versionN ?? null,
    jobId: r.jobId ?? null,
    note: r.note?.trim() || null,
    noteVisible: r.noteVisible ?? false,
    data: r.data ?? {},
  });
  u.orders.add(r.orderId);
}
