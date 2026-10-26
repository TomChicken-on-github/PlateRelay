import { createHash } from "node:crypto";
import { DEFAULT_QUEUE_RULES, type OrderView, type PersonView, type QueueRules } from "@platerelay/shared";
import { eq, inArray } from "drizzle-orm";
import { type Ctx, can, userId } from "../auth/actor.js";
import type { Db } from "../db/db.js";
import { type AnswerSnapshot, files, orders, printers, roles, userRoles, users } from "../db/schema.js";
import type { ObjectStorage } from "../storage/storage.js";
import type { OrderRow } from "./transition.js";

/** Signed preview links live this long. */
export const THUMB_TTL_S = 600;

/** Anonymous label for a submitter, stable per account: "选手 K07". */
export function aliasOf(id: string): string {
  const h = createHash("sha256").update(id).digest();
  return `选手 ${String.fromCharCode(65 + (h[0] % 26))}${String(h[1] % 100).padStart(2, "0")}`;
}

export interface People {
  get(id: string | null | undefined): PersonView | null;
  /** The submitter as this viewer may see them: anonymous without order:submitter-name:view-others. */
  owner(ctx: Ctx, id: string): PersonView;
}

export async function loadPeople(db: Db, ids: (string | null | undefined)[]): Promise<People> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = want.length
    ? await db
        .select({ id: users.id, name: users.displayName, role: roles.name })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(users.id, want))
    : [];
  const map = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, role: r.role }]));
  const get = (id: string | null | undefined): PersonView | null => (id ? (map.get(id) ?? { id, name: "已删除的账户", role: null }) : null);
  return {
    get,
    owner: (ctx, id) => (userId(ctx) === id || can(ctx, "order:submitter-name:view-others") ? get(id)! : { id: null, name: aliasOf(id), role: null }),
  };
}

export interface ViewExtras {
  queue?: Map<number, { position: number; aheadSeconds: number }>;
  waitReasons?: Map<number, string | null>;
  rules?: QueueRules;
  missingColours?: Map<number, string[]>;
}

/** Whether the owner may upload a new version now. The revise endpoint decides the details (limits, kind). */
export function revisable(r: OrderRow, rules: QueueRules, printerState: string | undefined): boolean {
  const rv = rules.revisions;
  if (!rv.enabled) return false;
  const state = r.status === "PENDING_REVIEW" || r.status === "QUEUED" || (r.status === "PRINTING" && printerState === "PREPARING" && rv.whenDispatched === "recall");
  return state && (rv.max === 0 || r.revisionCount < rv.max || r.modelSwitchCount < rules.modelSwitch.max);
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Builds the API shape for a batch of orders, applying the viewer's visibility rules. */
export async function orderViews(db: Db, storage: ObjectStorage, ctx: Ctx, rows: OrderRow[], extras: ViewExtras = {}): Promise<OrderView[]> {
  if (!rows.length) return [];
  const fileRows = await db.select().from(files).where(inArray(files.id, [...new Set(rows.map((r) => r.fileId))]));
  const fileMap = new Map(fileRows.map((f) => [f.id, f]));
  const printerIds = [...new Set(rows.map((r) => r.printerId).filter((x): x is string => !!x))];
  const printerRows = printerIds.length ? await db.select().from(printers).where(inArray(printers.id, printerIds)) : [];
  const printerMap = new Map(printerRows.map((p) => [p.id, p]));
  const retries = await db.select({ id: orders.id, retryOf: orders.retryOf }).from(orders).where(inArray(orders.retryOf, rows.map((r) => r.id)));
  const retryMap = new Map(retries.map((r) => [r.retryOf!, r.id]));
  const people = await loadPeople(
    db,
    rows.flatMap((r) => [r.ownerId, r.reviewedBy, r.cancelledBy, r.failedBy, r.attributedBy, r.storedBy, r.redeemedBy]),
  );
  const operate = can(ctx, "printer:operate");
  const rules = extras.rules ?? DEFAULT_QUEUE_RULES;

  return Promise.all(
    rows.map(async (r): Promise<OrderView> => {
      const f = fileMap.get(r.fileId)!;
      const p = r.printerId ? printerMap.get(r.printerId) : undefined;
      const onThisPrinter = p?.currentOrderId === r.id;
      const paused = r.status === "PRINTING" && onThisPrinter && p?.state === "ERROR_PAUSED";
      const progress = onThisPrinter && typeof p?.telemetry?.progress === "number" ? (p.telemetry.progress as number) : r.printedAt ? 100 : null;
      return {
        id: r.id,
        status: r.status,
        waitingForHandler: paused,
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        sourceFileId: f.id,
        plate: { index: r.plateIndex, count: r.plateCount, name: r.plateName },
        printerModel: r.printerModel,
        printerModelId: r.printerModelId,
        nozzles: r.nozzles,
        filaments: r.filaments,
        printSeconds: r.printSeconds,
        weightGrams: r.weightGrams,
        thumbUrl: r.thumbnailKey ? await storage.signedUrl(r.thumbnailKey, THUMB_TTL_S) : null,
        owner: people.owner(ctx, r.ownerId),
        isMine: userId(ctx) === r.ownerId,
        submittedAt: r.submittedAt.toISOString(),
        queue: extras.queue?.get(r.id) ?? null,
        waitReason: extras.waitReasons?.get(r.id) ?? null,
        printer: p ? { id: p.id, name: p.name, state: p.state } : null,
        progress,
        startedAt: iso(r.startedAt),
        printedAt: iso(r.printedAt),
        errorPausedMs: r.errorPausedMs,
        error: paused && operate ? (p?.error ?? null) : null,
        review: r.reviewedAt ? { by: people.get(r.reviewedBy), at: r.reviewedAt.toISOString(), reason: r.rejectReason } : null,
        cancel: r.cancelledAt ? { by: people.get(r.cancelledBy), at: r.cancelledAt.toISOString(), reason: r.cancelReason ?? "" } : null,
        failure: r.failedAt
          ? {
              by: people.get(r.failedBy),
              at: r.failedAt.toISOString(),
              reason: r.failureReason ?? "",
              attribution: r.attribution,
              attributedBy: people.get(r.attributedBy),
              attributedAt: iso(r.attributedAt),
            }
          : null,
        stored: r.storedAt ? { by: people.get(r.storedBy), at: r.storedAt.toISOString(), slot: r.storageSlot ?? "" } : null,
        redeemed: r.redeemedAt ? { by: people.get(r.redeemedBy), at: r.redeemedAt.toISOString() } : null,
        retryOf: r.retryOf,
        retriedAs: retryMap.get(r.id) ?? null,
        colourPref: r.colourPref,
        bedType: r.bedType,
        revisions: {
          count: r.revisionCount,
          max: rules.revisions.max,
          switches: r.modelSwitchCount,
          maxSwitches: rules.modelSwitch.max,
          baselineSeconds: rules.revisions.baseline === "original" ? (r.originalPrintSeconds ?? r.printSeconds) : r.printSeconds,
        },
        canRevise: userId(ctx) === r.ownerId && revisable(r, rules, onThisPrinter ? p?.state : undefined),
        revision: r.revision,
        ...(extras.missingColours?.has(r.id) ? { missingColours: extras.missingColours.get(r.id) } : {}),
      };
    }),
  );
}

export type { AnswerSnapshot, OrderView, PersonView };
