import type { OrderVersionView, VersionState } from "@platerelay/shared";
import { desc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../db/db.js";
import { orderVersions } from "../db/schema.js";
import type { OrderRow } from "./transition.js";

export type VersionRow = typeof orderVersions.$inferSelect;

/** The columns an order and its versions share: what the order prints. */
export type VersionFields = Pick<
  OrderRow,
  "fileId" | "plateIndex" | "plateCount" | "plateName" | "printerModel" | "printerModelId" | "nozzles" | "filaments" | "printSeconds" | "weightGrams" | "thumbnailKey" | "parts" | "partsTopKey" | "partsPickKey"
>;

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
  counted?: boolean;
  switched?: boolean;
  decidedBy?: string | null;
}

export async function addVersion(tx: Db, orderId: number, fields: VersionFields, v: NewVersion): Promise<VersionRow> {
  const [{ n }] = await tx.select({ n: max(orderVersions.n) }).from(orderVersions).where(eq(orderVersions.orderId, orderId));
  const [row] = await tx
    .insert(orderVersions)
    .values({
      orderId,
      n: (n ?? 0) + 1,
      ...fields,
      kind: v.kind,
      state: v.state,
      restoredFrom: v.restoredFrom ?? null,
      counted: v.counted ?? false,
      switched: v.switched ?? false,
      decidedBy: v.state === "approved" ? (v.decidedBy ?? null) : null,
      decidedAt: v.state === "approved" ? new Date() : null,
    })
    .returning();
  return row;
}

/** Newest first. */
export function versionsOf(tx: Db, orderId: number): Promise<VersionRow[]> {
  return tx.select().from(orderVersions).where(eq(orderVersions.orderId, orderId)).orderBy(desc(orderVersions.n));
}

/** The pending version(s) of an order; normally one. */
export function pendingOf(versions: VersionRow[]): VersionRow[] {
  return versions.filter((v) => v.state === "pending");
}

/** The newest approved version: what a withdrawn or rejected revision falls back to. */
export function lastApproved(versions: VersionRow[]): VersionRow | undefined {
  return versions.find((v) => v.state === "approved");
}

/** The version the order holds now: the newest one still in play, else the newest. */
export function currentOf(versions: VersionRow[]): VersionRow | undefined {
  return versions.find((v) => v.state === "pending" || v.state === "approved") ?? versions[0];
}

export async function decide(tx: Db, ids: number[], state: VersionState, by: string | null, reason?: string) {
  if (!ids.length) return;
  await tx
    .update(orderVersions)
    .set({ state, decidedBy: by, decidedAt: new Date(), reason: reason ?? null })
    .where(inArray(orderVersions.id, ids));
}
