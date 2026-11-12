import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { can, type Ctx, userIdOf } from "../common/ctx.js";
import { DB, type Db, type Tx } from "../db/db.js";
import { fileChecks, files, orderRecords, orders, orderVersions, printerLive, printerReasons, printers, printJobs, users } from "../db/schema.js";
import { type Finding, FilesService, type StoredPlate } from "../files/files.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { type ObjectStorage, STORAGE } from "../storage/storage.js";
import type { OrderRow, OrderStatus } from "./records.js";

export type VersionRow = typeof orderVersions.$inferSelect;

const SIGNED_URL_SECONDS = 300;
const NODES = ["SUBMIT", "REVIEW", "QUEUE", "PRINT", "STORE", "PICKUP"] as const;
type NodeName = (typeof NODES)[number];
type NodeState = "NOT_REACHED" | "ACTIVE" | "DONE" | "PROBLEM";

/** Where each status stands on the six steps of an order: the step it is at, and whether that step is going well. */
const AT: Record<OrderStatus, [NodeName, NodeState]> = {
  PENDING_REVIEW: ["REVIEW", "ACTIVE"],
  REJECTED: ["REVIEW", "PROBLEM"],
  QUEUED: ["QUEUE", "ACTIVE"],
  DISPATCHED: ["PRINT", "ACTIVE"],
  PRINTING: ["PRINT", "ACTIVE"],
  FAILED: ["PRINT", "PROBLEM"],
  PRINTED: ["STORE", "ACTIVE"],
  READY: ["PICKUP", "ACTIVE"],
  COMPLETED: ["PICKUP", "DONE"],
  DISPOSED: ["PICKUP", "PROBLEM"],
  CANCELLED: ["REVIEW", "PROBLEM"],
};

export interface Person {
  id: string | null;
  name: string;
  avatarUrl: string | null;
}

/** What the API returns for orders, cut to what the caller may see. */
@Injectable()
export class OrderViews {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
  ) {}

  /** Names of other people are shown only to those allowed to see them. */
  person(ctx: Ctx, u: { id: string; displayName: string } | null | undefined): Person | null {
    if (!u) return null;
    if (u.id !== userIdOf(ctx) && !can(ctx, "order:submitter-name:view-others")) return { id: null, name: "", avatarUrl: null };
    return { id: u.id, name: u.displayName, avatarUrl: null };
  }

  async people(ids: (string | null | undefined)[], tx: Tx = this.db) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = want.length ? await tx.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, want)) : [];
    return new Map(rows.map((r) => [r.id, r]));
  }

  private plateOf(v: VersionRow): StoredPlate {
    return {
      index: v.plateIndex,
      name: v.plateName,
      modelId: v.modelId,
      modelName: v.modelName,
      nozzles: v.nozzles as StoredPlate["nozzles"],
      filaments: v.filaments as StoredPlate["filaments"],
      printSeconds: v.printSeconds,
      weightGrams: v.weightGrams,
      slicedBedType: v.slicedBedType,
      parts: v.parts as StoredPlate["parts"],
      partsLabelled: true,
      thumbnailKey: v.thumbnailKey,
      partsTopKey: v.partsTopKey,
      partsPickKey: v.partsPickKey,
    };
  }

  async summaries(ctx: Ctx, rows: OrderRow[], tx: Tx = this.db) {
    if (!rows.length) return [];
    const me = userIdOf(ctx);
    const versions = new Map((await tx.select().from(orderVersions).where(inArray(orderVersions.id, rows.map((o) => o.activeVersionId)))).map((v) => [v.id, v]));
    const fileNames = new Map((await tx.select({ id: files.id, fileName: files.fileName }).from(files).where(inArray(files.id, [...versions.values()].map((v) => v.fileId)))).map((f) => [f.id, f.fileName]));
    const owners = await this.people(rows.map((o) => o.ownerId), tx);
    const queue = rows.some((o) => o.sortKey !== null && (o.status === "QUEUED" || o.status === "PENDING_REVIEW"))
      ? await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(isNotNull(orders.sortKey), inArray(orders.status, ["QUEUED", "PENDING_REVIEW"])))
          .orderBy(asc(orders.sortKey), asc(orders.id))
      : [];
    const printerIds = [...new Set(rows.map((o) => o.printerId).filter((x): x is string => !!x))];
    const printerRows = printerIds.length ? await tx.select({ id: printers.id, name: printers.name, state: printers.state }).from(printers).where(inArray(printers.id, printerIds)) : [];
    const reasons = printerIds.length ? await tx.select({ printerId: printerReasons.printerId, reason: printerReasons.reason }).from(printerReasons).where(inArray(printerReasons.printerId, printerIds)) : [];
    const lives = printerIds.length ? await tx.select({ printerId: printerLive.printerId, snapshot: printerLive.snapshot }).from(printerLive).where(inArray(printerLive.printerId, printerIds)) : [];

    return Promise.all(
      rows.map(async (o) => {
        const v = versions.get(o.activeVersionId)!;
        const mine = o.ownerId === me;
        const at = queue.findIndex((q) => q.id === o.id);
        const printer = printerRows.find((p) => p.id === o.printerId);
        const job = (lives.find((l) => l.printerId === o.printerId)?.snapshot as { job?: { jobRef?: string; percent?: number; remainingSeconds?: number } | null } | undefined)?.job;
        return {
          id: o.id,
          number: o.number,
          status: o.status,
          /* Frozen: holds its place while a revision awaits review, but cannot be dispatched. */
          frozen: o.status === "PENDING_REVIEW" && o.sortKey !== null,
          owner: this.person(ctx, owners.get(o.ownerId))!,
          isMine: mine,
          ...(mine || can(ctx, "order:view:any") ? { fileName: fileNames.get(v.fileId) ?? "" } : {}),
          plate: await this.files.plateView(this.plateOf(v)),
          colourPref: o.colourPref,
          bedType: o.bedType,
          submittedAt: o.submittedAt.toISOString(),
          /* Applicants see their own place and how many are ahead, never who. */
          queue: at >= 0 ? { position: at + 1, ahead: at, wait: null } : null,
          printer: printer && (o.status === "DISPATCHED" || o.status === "PRINTING" || o.status === "PRINTED" || o.status === "FAILED") ? { id: printer.id, name: printer.name, state: printer.state, reasons: reasons.filter((r) => r.printerId === printer.id).map((r) => r.reason) } : null,
          progress: (o.status === "PRINTING" || o.status === "DISPATCHED") && job && job.jobRef === o.currentJobId && typeof job.percent === "number" ? { percent: Math.round(job.percent), remainingSeconds: job.remainingSeconds ?? null } : null,
        };
      }),
    );
  }

  async summary(ctx: Ctx, row: OrderRow, tx: Tx = this.db) {
    return (await this.summaries(ctx, [row], tx))[0];
  }

  private async versionView(ctx: Ctx, o: OrderRow, v: VersionRow, all: VersionRow[], fileNames: Map<string, { fileName: string; purgedAt: Date | null }>) {
    return {
      id: v.id,
      n: v.n,
      kind: v.kind,
      state: v.state,
      restoredFromN: all.find((x) => x.id === v.restoredFromId)?.n ?? null,
      plate: await this.files.plateView(this.plateOf(v)),
      ...(o.ownerId === userIdOf(ctx) || can(ctx, "order:view:any") ? { fileName: fileNames.get(v.fileId)?.fileName ?? "" } : {}),
      deltaSeconds: v.deltaSeconds,
      placesBack: v.placesBack,
      counted: v.counted,
      modelSwitch: v.modelSwitch,
      createdAt: v.createdAt.toISOString(),
      decidedAt: v.decidedAt?.toISOString() ?? null,
      reason: v.reason,
      fileAvailable: !fileNames.get(v.fileId)?.purgedAt && !(o.filesExpireAt && o.filesExpireAt < new Date()),
    };
  }

  async detail(ctx: Ctx, o: OrderRow, tx: Tx = this.db) {
    const mine = o.ownerId === userIdOf(ctx);
    const staff = can(ctx, "order:view:any");
    const base = await this.summary(ctx, o, tx);
    const versions = await tx.select().from(orderVersions).where(eq(orderVersions.orderId, o.id)).orderBy(asc(orderVersions.n));
    const fileRows = await tx.select({ id: files.id, fileName: files.fileName, purgedAt: files.purgedAt }).from(files).where(inArray(files.id, versions.map((v) => v.fileId)));
    const fileNames = new Map(fileRows.map((f) => [f.id, f]));
    const view = (v: VersionRow) => this.versionView(ctx, o, v, versions, fileNames);
    const active = versions.find((v) => v.id === o.activeVersionId)!;
    const pending = versions.find((v) => v.id === o.pendingVersionId);
    const rules = await this.settings.get("revision");
    const jobs = await tx
      .select({ job: printJobs, printerName: printers.name })
      .from(printJobs)
      .innerJoin(printers, eq(printers.id, printJobs.printerId))
      .where(eq(printJobs.orderId, o.id))
      .orderBy(desc(printJobs.attempt));
    const current = jobs.find((j) => j.job.id === o.currentJobId && j.job.phase !== "ENDED")?.job;
    const records = await tx
      .select({ node: orderRecords.node, note: orderRecords.note, noteVisible: orderRecords.noteVisible })
      .from(orderRecords)
      .where(and(eq(orderRecords.orderId, o.id), isNotNull(orderRecords.note)))
      .orderBy(desc(orderRecords.id));
    const decliner = o.reprintDeclinedBy ? (await this.people([o.reprintDeclinedBy], tx)).get(o.reprintDeclinedBy) : null;
    const findings = can(ctx, "order:review") ? (((await tx.select({ findings: fileChecks.findings }).from(fileChecks).where(eq(fileChecks.fileId, (pending ?? active).fileId)))[0]?.findings as Finding[]) ?? []) : undefined;
    const parts = active.parts as { id: number }[];
    const expired = !!o.filesExpireAt && o.filesExpireAt < new Date();

    return {
      ...base,
      activeVersion: await view(active),
      pendingVersion: pending ? await view(pending) : null,
      versions: await Promise.all(versions.map(view)),
      /* Form answers are for the applicant, the reviewer and admins. */
      ...(mine || can(ctx, "order:review") ? { answers: o.answers } : {}),
      revisions: { used: o.revisionCount, max: rules.maxCount, modelSwitches: o.modelSwitchCount, maxModelSwitches: rules.modelSwitchMax },
      nodes: this.nodes(o, records, mine && !staff),
      ...(findings ? { findings } : {}),
      storage: o.storageSlot ? { slot: o.storageSlot, photoUrl: o.storePhotoKey && (mine || staff) ? await this.storage.signedUrl(o.storePhotoKey, SIGNED_URL_SECONDS) : null } : null,
      parts: parts.length ? { total: parts.length, skipped: current?.skippedParts ?? [], canSkip: !!current && (current.phase === "PRINTING" || (current.phase === "PAUSED" && current.pausedFrom === "PRINTING")) } : null,
      actions: this.actions(ctx, o, current?.phase),
      printJobs: await Promise.all(
        jobs.map(async ({ job, printerName }) => ({
          jobId: job.id,
          attempt: job.attempt,
          printerName,
          startedAt: job.startedAt?.toISOString() ?? null,
          endedAt: job.endedAt?.toISOString() ?? null,
          outcome: job.outcome,
          endPhoto: job.endPhotoKey && job.endPhotoAt && (mine || staff) ? { capturedAt: job.endPhotoAt.toISOString(), url: await this.storage.signedUrl(job.endPhotoKey, SIGNED_URL_SECONDS) } : null,
        })),
      ),
      reprintBlockedReason: o.status !== "FAILED" ? null : expired ? "file_expired" : o.archivedAt ? "archived" : o.reprintDeclinedAt ? "declined" : null,
      reprintDeclined: o.reprintDeclinedAt ? { at: o.reprintDeclinedAt.toISOString(), by: this.person(ctx, decliner), reason: staff || o.reprintDeclinedReasonVisible ? o.reprintDeclinedReason : null } : null,
    };
  }

  /** The six steps with their state and latest note. Steps before the current one are done; a cancellation marks the step it happened at. */
  private nodes(o: OrderRow, records: { node: NodeName; note: string | null; noteVisible: boolean }[], applicantView: boolean) {
    let [at, state] = AT[o.status];
    if (o.status === "CANCELLED") at = o.sortKey === null ? "REVIEW" : "QUEUE";
    if (o.status === "DISPOSED" && !o.storageSlot) at = "STORE";
    const i = NODES.indexOf(at);
    return NODES.map((node, n) => ({
      node,
      state: n < i ? ("DONE" as NodeState) : n === i ? state : ("NOT_REACHED" as NodeState),
      label: null,
      note: records.find((r) => r.node === node && (r.noteVisible || !applicantView))?.note ?? null,
    }));
  }

  /** Operations the caller could perform on the order right now; the front end shows buttons from this. */
  private actions(ctx: Ctx, o: OrderRow, phase?: string): string[] {
    const mine = o.ownerId === userIdOf(ctx);
    const out: string[] = [];
    const add = (when: unknown, ...ops: string[]) => void (when && out.push(...ops));
    const neverApproved = o.sortKey === null;
    add(o.status === "PENDING_REVIEW" && can(ctx, "order:review"), "approveOrder", "rejectOrder");
    add((o.status === "PENDING_REVIEW" || o.status === "QUEUED") && ((mine && can(ctx, "order:cancel:own")) || can(ctx, "order:cancel:any")), "cancelOrder");
    add(mine && ((o.status === "PENDING_REVIEW" && neverApproved) || o.status === "QUEUED"), "reviseOrder");
    add(mine && o.status === "PENDING_REVIEW" && o.pendingVersionId, "withdrawRevision");
    add(mine && o.status === "QUEUED", "restoreVersion");
    add(o.status === "FAILED" && can(ctx, "order:reprint") && !o.archivedAt && !o.reprintDeclinedAt && !(o.filesExpireAt && o.filesExpireAt < new Date()), "reprintOrder");
    add(o.status === "FAILED" && can(ctx, "order:reprint") && !o.archivedAt && !o.reprintDeclinedAt, "declineReprint");
    add(o.status === "FAILED" && can(ctx, "order:reprint:restore") && !o.archivedAt && o.reprintDeclinedAt, "revokeReprintDecline");
    add(o.status === "PRINTED" && can(ctx, "order:store"), "storeOrder");
    add(o.status === "READY" && mine, "issuePickupCode");
    add((o.status === "READY" || o.status === "PRINTED") && can(ctx, "order:dispose"), "disposeOrder");
    add(phase === "PRINTING" && ((mine && can(ctx, "order:skip-parts:own")) || can(ctx, "order:skip-parts:any")), "skipParts");
    return out;
  }

  /** Orders with a place in the queue, first to last. */
  async queueRows(tx: Tx = this.db) {
    return tx
      .select()
      .from(orders)
      .where(and(isNotNull(orders.sortKey), inArray(orders.status, ["QUEUED", "PENDING_REVIEW"])))
      .orderBy(asc(orders.sortKey), asc(orders.id));
  }

  async activeJobOf(orderId: string, tx: Tx = this.db) {
    const [job] = await tx
      .select()
      .from(printJobs)
      .where(and(eq(printJobs.orderId, orderId), ne(printJobs.phase, "ENDED")));
    return job;
  }
}
