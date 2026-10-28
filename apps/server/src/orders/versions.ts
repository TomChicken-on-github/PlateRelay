import type { OrderVersionView, VersionState } from "@platerelay/shared";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../db/db.js";
import { orders, orderVersions, type VersionDecision } from "../db/schema.js";
import { type OrderRow, orderRow, type VersionFields, type VersionRow } from "./rows.js";

export type { VersionFields, VersionRow };

export function versionFields(r: VersionFields): VersionFields {
  return {
    fileId: r.fileId,
    plateIndex: r.plateIndex,
    plateCount: r.plateCount,
    plateName: r.plateName,
    printerModel: r.printerModel,
    printerModelId: r.printerModelId,
    nozzles: r.nozzles,
    filaments: r.filaments,
    printSeconds: r.printSeconds,
    weightGrams: r.weightGrams,
    thumbnailKey: r.thumbnailKey,
    parts: r.parts,
    partsTopKey: r.partsTopKey,
    partsPickKey: r.partsPickKey,
  };
}

export interface NewVersion {
  kind: OrderVersionView["kind"];
  state: VersionState;
  restoredFrom?: number | null;
  decision?: VersionDecision | null;
  counted?: boolean;
  switched?: boolean;
  decidedBy?: string | null;
}

/** Versions are written once (a trigger refuses later changes except the review decision). */
export async function addVersion(tx: Db, orderId: number, fields: VersionFields, v: NewVersion): Promise<VersionRow> {
  const [{ n }] = await tx.select({ n: max(orderVersions.n) }).from(orderVersions).where(eq(orderVersions.orderId, orderId));
  const [row] = await tx
    .insert(orderVersions)
    .values({
      orderId,
      n: (n ?? 0) + 1,
      ...versionFields(fields),
      kind: v.kind,
      state: v.state,
      restoredFrom: v.restoredFrom ?? null,
      decision: v.decision ?? null,
      counted: v.counted ?? false,
      switched: v.switched ?? false,
      decidedBy: v.state === "approved" ? (v.decidedBy ?? null) : null,
      decidedAt: v.state === "approved" ? new Date() : null,
    })
    .returning();
  return row;
}

/** Inserts an order with its first version and points the order at it, in the caller's transaction. */
export async function createOrder(tx: Db, values: Omit<typeof orders.$inferInsert, "activeVersionId" | "pendingVersionId">, fields: VersionFields, v: NewVersion): Promise<OrderRow> {
  const [o] = await tx.insert(orders).values(values).returning({ id: orders.id });
  const ver = await addVersion(tx, o.id, fields, v);
  await tx.update(orders).set({ activeVersionId: ver.id }).where(eq(orders.id, o.id));
  return (await orderRow(tx, o.id))!;
}

/** Newest first. */
export function versionsOf(tx: Db, orderId: number): Promise<VersionRow[]> {
  return tx.select().from(orderVersions).where(eq(orderVersions.orderId, orderId)).orderBy(desc(orderVersions.n));
}

/** The order's pointed-at versions that still wait for a decision: the pending revision, or a first submission not reviewed yet. */
export function undecided(o: Pick<OrderRow, "activeVersionId" | "pendingVersionId">, versions: VersionRow[]): VersionRow[] {
  return versions.filter((v) => v.state === "pending" && (v.id === o.pendingVersionId || v.id === o.activeVersionId));
}

/** Records the review decision on pending versions; anything already decided is left alone. */
export async function decide(tx: Db, ids: number[], state: VersionState, by: string | null, reason?: string) {
  if (!ids.length) return;
  await tx
    .update(orderVersions)
    .set({ state, decidedBy: by, decidedAt: new Date(), reason: reason ?? null })
    .where(and(inArray(orderVersions.id, ids), eq(orderVersions.state, "pending")));
}
