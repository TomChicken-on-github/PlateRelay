import type { RevisionInfo } from "@platerelay/shared";
import { eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/db.js";
import { files, orders, orderVersions } from "../db/schema.js";

export type VersionRow = typeof orderVersions.$inferSelect;

/** What a version holds and the order prints: the file and what the panel read from it. */
export type VersionFields = Pick<
  VersionRow,
  "fileId" | "plateIndex" | "plateCount" | "plateName" | "printerModel" | "printerModelId" | "nozzles" | "filaments" | "printSeconds" | "weightGrams" | "thumbnailKey" | "parts" | "partsTopKey" | "partsPickKey"
>;

const versionColumns = {
  fileId: orderVersions.fileId,
  plateIndex: orderVersions.plateIndex,
  plateCount: orderVersions.plateCount,
  plateName: orderVersions.plateName,
  printerModel: orderVersions.printerModel,
  printerModelId: orderVersions.printerModelId,
  nozzles: orderVersions.nozzles,
  filaments: orderVersions.filaments,
  printSeconds: orderVersions.printSeconds,
  weightGrams: orderVersions.weightGrams,
  thumbnailKey: orderVersions.thumbnailKey,
  parts: orderVersions.parts,
  partsTopKey: orderVersions.partsTopKey,
  partsPickKey: orderVersions.partsPickKey,
};

/**
 * An order with the version it shows: the revision under review if there is one, else the active
 * version. `revision` describes that pending revision against the active one.
 */
export type OrderRow = typeof orders.$inferSelect & VersionFields & { revision: RevisionInfo | null };

/** The version an order shows, for joins: pending ?? active. */
export const shownVersion = eq(orderVersions.id, sql`coalesce(${orders.pendingVersionId}, ${orders.activeVersionId})`);

export interface RowQuery {
  orderBy?: (SQL | PgColumn)[];
  limit?: number;
  offset?: number;
}

export async function orderRows(db: Db, where?: SQL, q: RowQuery = {}): Promise<OrderRow[]> {
  let query = db.select({ o: orders, v: versionColumns }).from(orders).innerJoin(orderVersions, shownVersion).where(where).$dynamic();
  if (q.orderBy?.length) query = query.orderBy(...q.orderBy);
  if (q.limit != null) query = query.limit(q.limit);
  if (q.offset) query = query.offset(q.offset);
  const rows = await query;
  return withRevisions(db, rows.map((r) => ({ ...r.o, ...r.v, revision: null }) as OrderRow));
}

/**
 * One order. `lock` takes its row lock first, on the order alone: a FOR UPDATE over the join would,
 * after waiting, recheck the join against the old snapshot and lose a row whose pointer moved to a
 * version created meanwhile. The read after the lock sees the committed pointers.
 */
export async function orderRow(db: Db, id: number, lock = false): Promise<OrderRow | undefined> {
  if (lock && !(await db.select({ id: orders.id }).from(orders).where(eq(orders.id, id)).for("update")).length) return undefined;
  return (await orderRows(db, eq(orders.id, id)))[0];
}

/** Builds RevisionInfo from the two pointers: the pending version, compared with the active one. */
async function withRevisions(db: Db, rows: OrderRow[]): Promise<OrderRow[]> {
  const ids = rows.flatMap((r) => (r.pendingVersionId != null ? [r.pendingVersionId, r.activeVersionId!] : []));
  if (!ids.length) return rows;
  const vs = await db
    .select({ v: orderVersions, fileName: files.fileName })
    .from(orderVersions)
    .innerJoin(files, eq(files.id, orderVersions.fileId))
    .where(inArray(orderVersions.id, ids));
  const byId = new Map(vs.map((x) => [x.v.id, x]));
  for (const r of rows) {
    if (r.pendingVersionId == null) continue;
    const { v: next } = byId.get(r.pendingVersionId)!;
    const { v: prev, fileName } = byId.get(r.activeVersionId!)!;
    r.revision = {
      n: next.n - 1,
      kind: next.kind as RevisionInfo["kind"],
      at: next.createdAt.toISOString(),
      prev: { fileName, printerModel: prev.printerModel, printerModelId: prev.printerModelId, nozzles: prev.nozzles, filaments: prev.filaments, printSeconds: prev.printSeconds, weightGrams: prev.weightGrams },
      deltaSeconds: next.decision?.deltaSeconds ?? 0,
      placesBack: next.decision?.placesBack ?? 0,
      recalled: next.decision?.recalled ?? false,
    };
  }
  return rows;
}
