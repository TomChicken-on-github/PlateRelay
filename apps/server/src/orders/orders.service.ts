import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { can, type Ctx, userIdOf } from "../common/ctx.js";
import { notFound, Problem, ruleViolation, stateConflict } from "../common/problem.js";
import { type Uow, Work } from "../core/uow.js";
import { DB, type Db } from "../db/db.js";
import { files, formVersions, orderRecords, orders, orderVersions, printers, printJobs } from "../db/schema.js";
import { FilesService, fits, type StoredPlate } from "../files/files.service.js";
import { lockPrinter, settlePrinter } from "../jobs/printer-state.js";
import type { SectionValues } from "../settings/definitions.js";
import { SettingsService } from "../settings/settings.service.js";
import { type ObjectStorage, STORAGE } from "../storage/storage.js";
import { lockQueue, moveBack, placeAfter, placesBackFor, tailKey } from "./queue.js";
import { type OrderRow, type OrderStatus, record } from "./records.js";
import { OrderViews, type VersionRow } from "./views.js";

const UNFINISHED: OrderStatus[] = ["PENDING_REVIEW", "QUEUED", "DISPATCHED", "PRINTING"];
const SIGNED_URL_SECONDS = 300;

export interface FormField {
  id: string;
  label: string;
  type: "text" | "textarea" | "single" | "multi" | "number";
  required: boolean;
  options?: string[];
}

const plateColumns = (p: StoredPlate, plateCount: number) => ({
  plateIndex: p.index,
  plateCount,
  plateName: p.name,
  modelId: p.modelId,
  modelName: p.modelName,
  nozzles: p.nozzles,
  filaments: p.filaments,
  printSeconds: p.printSeconds,
  weightGrams: Math.round(p.weightGrams),
  slicedBedType: p.slicedBedType,
  thumbnailKey: p.thumbnailKey,
  parts: p.parts,
  partsTopKey: p.partsTopKey,
  partsPickKey: p.partsPickKey,
});

/**
 * Everything a person does to an order outside of printing: submitting, reviewing, revising,
 * cancelling, reprinting, storing and disposing. Printing itself (dispatched, printing, failed,
 * printed) is moved only by the job engine, on what the printer reports.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly work: Work,
    private readonly views: OrderViews,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /* ───────── reading ───────── */

  /** The order, if the caller may see it. Anything else looks like it does not exist. */
  async visible(ctx: Ctx, orderId: string): Promise<OrderRow> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o || (o.ownerId !== userIdOf(ctx) && !can(ctx, "order:view:any"))) throw notFound("order");
    return o;
  }

  async detail(ctx: Ctx, orderId: string) {
    return this.views.detail(ctx, await this.visible(ctx, orderId));
  }

  async list(ctx: Ctx, q: { mine: boolean; limit?: string; cursor?: string; status?: string; ownerId?: string; printerId?: string; number?: string; q?: string; submittedFrom?: string; submittedTo?: string }) {
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const statuses = (q.status ?? "").split(",").filter(Boolean) as OrderStatus[];
    const where = and(
      q.mine ? eq(orders.ownerId, userIdOf(ctx)!) : undefined,
      q.cursor ? lt(orders.id, q.cursor) : undefined,
      statuses.length ? inArray(orders.status, statuses) : undefined,
      !q.mine && q.ownerId ? eq(orders.ownerId, q.ownerId) : undefined,
      q.printerId ? eq(orders.printerId, q.printerId) : undefined,
      q.number ? eq(orders.number, Number(q.number)) : undefined,
      q.submittedFrom ? gte(orders.submittedAt, new Date(q.submittedFrom)) : undefined,
      q.submittedTo ? lte(orders.submittedAt, new Date(q.submittedTo)) : undefined,
      q.q
        ? inArray(
            orders.activeVersionId,
            this.db
              .select({ id: orderVersions.id })
              .from(orderVersions)
              .innerJoin(files, eq(files.id, orderVersions.fileId))
              .where(ilike(files.fileName, `%${q.q.replace(/[%_\\]/g, "\\$&")}%`)),
          )
        : undefined,
    );
    const rows = await this.db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { items: await this.views.summaries(ctx, page), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** The timeline. Applicants see their own order's records, with notes only where those were marked visible. */
  async records(ctx: Ctx, orderId: string) {
    const o = await this.visible(ctx, orderId);
    const staff = can(ctx, "order:view:any");
    const rows = await this.db.select().from(orderRecords).where(eq(orderRecords.orderId, o.id)).orderBy(asc(orderRecords.id));
    const people = await this.views.people(rows.filter((r) => r.actorType === "USER").map((r) => r.actorId));
    return rows.map((r) => this.recordView(ctx, r, people, staff));
  }

  private recordView(ctx: Ctx, r: typeof orderRecords.$inferSelect, people: Map<string, { id: string; displayName: string }>, staff: boolean) {
    return {
      id: r.id,
      at: r.at.toISOString(),
      node: r.node,
      kind: r.kind,
      /* Applicants are not told which member of staff did something. */
      actor: r.actorType === "USER" && r.actorId ? this.views.person(ctx, people.get(r.actorId)) : null,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
      versionN: r.versionN,
      note: staff || r.noteVisible ? r.note : null,
      noteVisible: r.noteVisible,
      data: r.data as Record<string, unknown>,
    };
  }

  /** A short-lived link to the file of one version, while the file is kept. */
  async versionFileUrl(ctx: Ctx, orderId: string, n: number): Promise<string> {
    const o = await this.visible(ctx, orderId);
    const [v] = await this.db
      .select({ fileName: files.fileName, objectKey: files.objectKey, purgedAt: files.purgedAt })
      .from(orderVersions)
      .innerJoin(files, eq(files.id, orderVersions.fileId))
      .where(and(eq(orderVersions.orderId, o.id), eq(orderVersions.n, n)));
    if (!v) throw notFound("version");
    if (v.purgedAt || (o.filesExpireAt && o.filesExpireAt < new Date())) throw new Problem(410, "file_expired", "the file is no longer kept");
    return this.storage.signedUrl(v.objectKey, SIGNED_URL_SECONDS, v.fileName);
  }

  async parts(ctx: Ctx, orderId: string) {
    const o = await this.visible(ctx, orderId);
    if (o.ownerId !== userIdOf(ctx) && !can(ctx, "order:skip-parts:any")) throw notFound("order");
    const [v] = await this.db.select().from(orderVersions).where(eq(orderVersions.id, o.activeVersionId));
    const job = await this.views.activeJobOf(o.id);
    return {
      parts: v.parts as { id: number; name: string }[],
      topUrl: v.partsTopKey ? await this.storage.signedUrl(v.partsTopKey, SIGNED_URL_SECONDS) : null,
      pickUrl: v.partsPickKey ? await this.storage.signedUrl(v.partsPickKey, SIGNED_URL_SECONDS) : null,
      skipped: job?.skippedParts ?? [],
    };
  }

  /* ───────── the submission form ───────── */

  async form() {
    const [latest] = await this.db.select().from(formVersions).orderBy(desc(formVersions.id)).limit(1);
    const row = latest ?? (await this.db.insert(formVersions).values({ fields: [] }).returning())[0];
    return { versionId: row.id, fields: row.fields as FormField[], createdAt: row.createdAt.toISOString() };
  }

  /** Saving makes a new version; orders keep the version they were submitted with. */
  async saveForm(ctx: Ctx, basedOnVersionId: string, fields: FormField[]) {
    const current = await this.form();
    if (current.versionId !== basedOnVersionId) throw new Problem(409, "version_conflict", "the form was changed by someone else meanwhile", { currentVersion: current.versionId });
    if (new Set(fields.map((f) => f.id)).size !== fields.length) throw ruleViolation("field ids must be unique");
    await this.db.transaction(async (tx) => {
      await tx.insert(formVersions).values({ fields, createdBy: userIdOf(ctx) });
      await this.audit.record(ctx, { action: "form.save", targetType: "form", before: { fields: current.fields }, after: { fields } }, tx);
    });
    return this.form();
  }

  private async checkAnswers(formVersionId: string, answers: { fieldId: string; value: unknown }[]) {
    const [form] = await this.db.select().from(formVersions).where(eq(formVersions.id, formVersionId));
    if (!form) throw ruleViolation("unknown form version");
    const issues: { path: string; code: string }[] = [];
    const out = (form.fields as FormField[]).map((f) => {
      const value = answers.find((a) => a.fieldId === f.id)?.value ?? null;
      const empty = value === null || value === "" || (Array.isArray(value) && !value.length);
      const ok =
        empty ||
        (f.type === "number" ? typeof value === "number" : f.type === "multi" ? Array.isArray(value) && value.every((x) => f.options?.includes(x as string)) : typeof value === "string" && (f.type !== "single" || !!f.options?.includes(value)));
      if (f.required && empty) issues.push({ path: `/answers/${f.id}`, code: "required" });
      else if (!ok) issues.push({ path: `/answers/${f.id}`, code: "type" });
      return { fieldId: f.id, label: f.label, type: f.type, value: empty ? null : value };
    });
    if (issues.length) throw new Problem(422, "validation_failed", "form answers are incomplete", undefined, issues);
    return out;
  }

  /* ───────── submitting ───────── */

  /** A plate of a file the caller uploaded, usable for an order: the file passed its checks and some open printer can print the plate. */
  private async usablePlate(ctx: Ctx, fileId: string, plateIndex: number) {
    const row = await this.files.load(fileId);
    if (!row || row.file.uploadedBy !== userIdOf(ctx) || row.file.purgedAt) throw notFound("file");
    if (row.check.verdict === "REJECT") throw ruleViolation("the file did not pass its checks", { rule: "file_rejected" });
    const plates = row.check.plates as StoredPlate[];
    const plate = plates.find((p) => p.index === plateIndex);
    if (!plate) throw ruleViolation("the file has no such plate", { rule: "no_such_plate", plate: plateIndex });
    if (!fits(plate, await this.files.openModels())) throw ruleViolation("no open printer matches the model and nozzles of this plate", { rule: "no_matching_printer", plate: plateIndex });
    return { plate, plateCount: plates.length };
  }

  /** One order per chosen plate; all of them or none. */
  async submit(ctx: Ctx, b: { fileId: string; plates: number[]; colourPref: "EXACT" | "SIMILAR" | "ANY"; bedType?: string | null; formVersionId: string; answers: { fieldId: string; value: unknown }[] }) {
    const ownerId = userIdOf(ctx)!;
    const plateIndexes = [...new Set(b.plates)];
    if (!plateIndexes.length) throw ruleViolation("choose at least one plate");
    const chosen: Awaited<ReturnType<OrdersService["usablePlate"]>>[] = [];
    for (const i of plateIndexes) chosen.push(await this.usablePlate(ctx, b.fileId, i));
    const answers = await this.checkAnswers(b.formVersionId, b.answers);
    const queue = await this.settings.get("queue");

    const ids = await this.work.run(async (u) => {
      if (queue.maxUnfinishedPerUser > 0) {
        /* Serialises one person's submissions so two at once cannot both slip under the limit. */
        await u.tx.execute(sql`select pg_advisory_xact_lock(7002, hashtext(${ownerId}))`);
        const [{ n }] = await u.tx
          .select({ n: sql<number>`count(*)::int` })
          .from(orders)
          .where(and(eq(orders.ownerId, ownerId), inArray(orders.status, UNFINISHED)));
        if (n + chosen.length > queue.maxUnfinishedPerUser) throw ruleViolation("too many unfinished orders", { rule: "unfinished_limit", limit: queue.maxUnfinishedPerUser, current: n });
      }
      const out: string[] = [];
      for (const { plate, plateCount } of chosen) {
        const [o] = await u.tx
          .insert(orders)
          .values({ ownerId, activeVersionId: sql`gen_random_uuid()`, colourPref: b.colourPref, bedType: queue.applicantPicksBed ? (b.bedType ?? null) : null, formVersionId: b.formVersionId, answers })
          .returning();
        const [v] = await u.tx
          .insert(orderVersions)
          .values({ orderId: o.id, n: 1, kind: "SUBMIT", fileId: b.fileId, ...plateColumns(plate, plateCount) })
          .returning();
        await u.tx.update(orders).set({ activeVersionId: v.id }).where(eq(orders.id, o.id));
        await record(u, ctx, { orderId: o.id, kind: "order.submitted", to: "PENDING_REVIEW", versionN: 1 });
        out.push(o.id);
      }
      await u.tx.update(files).set({ submittedAt: new Date() }).where(eq(files.id, b.fileId));
      u.todo = true;
      return out;
    });
    const rows = await this.db.select().from(orders).where(inArray(orders.id, ids)).orderBy(asc(orders.number));
    return { orders: await this.views.summaries(ctx, rows) };
  }

  /* ───────── helpers for changes ───────── */

  private async lock(u: Uow, orderId: string, expected?: OrderStatus): Promise<OrderRow> {
    const [o] = await u.tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) throw notFound("order");
    if (expected && o.status !== expected) throw stateConflict(o.status, expected);
    return o;
  }

  private async lockMine(u: Uow, ctx: Ctx, orderId: string, expected: OrderStatus): Promise<OrderRow> {
    const [seen] = await u.tx.select({ ownerId: orders.ownerId }).from(orders).where(eq(orders.id, orderId));
    if (!seen || seen.ownerId !== userIdOf(ctx)) throw notFound("order");
    return this.lock(u, orderId, expected);
  }

  private async version(u: Uow, id: string): Promise<VersionRow> {
    const [v] = await u.tx.select().from(orderVersions).where(eq(orderVersions.id, id));
    return v;
  }

  private async decide(u: Uow, ctx: Ctx, versionId: string, state: "APPROVED" | "REJECTED" | "WITHDRAWN" | "REPLACED", reason: string | null = null) {
    await u.tx
      .update(orderVersions)
      .set({ state, decidedBy: userIdOf(ctx), decidedAt: new Date(), reason })
      .where(eq(orderVersions.id, versionId));
  }

  private async close(u: Uow, o: OrderRow, to: "REJECTED" | "CANCELLED" | "COMPLETED" | "DISPOSED", extra: Partial<typeof orders.$inferInsert> = {}) {
    const at = new Date();
    const { retentionDays } = await this.settings.get("files");
    await u.tx
      .update(orders)
      .set({ status: to, closedAt: at, filesExpireAt: new Date(at.getTime() + retentionDays * 86_400_000), ...extra })
      .where(eq(orders.id, o.id));
    u.todo = true;
    if (o.sortKey !== null) u.queue = true;
  }

  /* ───────── review ───────── */

  async approve(ctx: Ctx, orderId: string, b: { expectedStatus: OrderStatus; versionId: string; note?: string | null }) {
    await this.work.run(async (u) => {
      await lockQueue(u);
      const o = await this.lock(u, orderId, "PENDING_REVIEW");
      if (b.expectedStatus !== "PENDING_REVIEW") throw stateConflict(o.status, b.expectedStatus);
      const reviewing = o.pendingVersionId ?? o.activeVersionId;
      /* The reviewer approves the version they looked at; a newer upload since then needs another look. */
      if (b.versionId !== reviewing) throw new Problem(409, "version_conflict", "a newer version was uploaded meanwhile", { currentVersion: reviewing });
      const v = await this.version(u, reviewing);
      await this.decide(u, ctx, v.id, "APPROVED");
      if (o.sortKey === null) {
        await u.tx
          .update(orders)
          .set({ status: "QUEUED", sortKey: await tailKey(u) })
          .where(eq(orders.id, o.id));
        await record(u, ctx, { orderId: o.id, kind: "order.approved", from: "PENDING_REVIEW", to: "QUEUED", versionN: v.n, note: b.note, noteVisible: true });
      } else {
        await u.tx
          .update(orders)
          .set({ status: "QUEUED", activeVersionId: v.id, pendingVersionId: null, revisionCount: o.revisionCount + (v.counted ? 1 : 0), modelSwitchCount: o.modelSwitchCount + (v.modelSwitch ? 1 : 0) })
          .where(eq(orders.id, o.id));
        await record(u, ctx, { orderId: o.id, kind: "version.approved", from: "PENDING_REVIEW", to: "QUEUED", versionN: v.n, note: b.note, noteVisible: true, data: { placesBack: v.placesBack ?? 0 } });
        await this.applyMoveBack(u, ctx, o, v);
      }
      u.queue = true;
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  private async applyMoveBack(u: Uow, ctx: Ctx, o: OrderRow, v: Pick<VersionRow, "n" | "placesBack">) {
    if (!v.placesBack || o.sortKey === null) return;
    await moveBack(u, o.id, o.sortKey, v.placesBack);
    await record(u, ctx, { orderId: o.id, kind: "queue.moved_back", versionN: v.n, noteVisible: true, data: { places: v.placesBack } });
  }

  async reject(ctx: Ctx, orderId: string, b: { expectedStatus: OrderStatus; versionId: string; reason: string; reasonVisible?: boolean }) {
    await this.work.run(async (u) => {
      const o = await this.lock(u, orderId, "PENDING_REVIEW");
      const reviewing = o.pendingVersionId ?? o.activeVersionId;
      if (b.versionId !== reviewing) throw new Problem(409, "version_conflict", "a newer version was uploaded meanwhile", { currentVersion: reviewing });
      const v = await this.version(u, reviewing);
      await this.decide(u, ctx, v.id, "REJECTED", b.reason);
      const noteVisible = b.reasonVisible ?? true;
      if (o.sortKey === null) {
        await this.close(u, o, "REJECTED");
        await record(u, ctx, { orderId: o.id, kind: "order.rejected", from: "PENDING_REVIEW", to: "REJECTED", versionN: v.n, note: b.reason, noteVisible });
      } else {
        /* A rejected revision: the order goes on with the version approved before, in its place. */
        await u.tx.update(orders).set({ status: "QUEUED", pendingVersionId: null }).where(eq(orders.id, o.id));
        await record(u, ctx, { orderId: o.id, kind: "version.rejected", from: "PENDING_REVIEW", to: "QUEUED", versionN: v.n, note: b.reason, noteVisible });
        u.queue = true;
        u.todo = true;
      }
    });
    return this.detail(ctx, orderId);
  }

  /* ───────── versions ───────── */

  async revise(ctx: Ctx, orderId: string, b: { expectedStatus: OrderStatus; fileId: string; plate: number }) {
    const { plate, plateCount } = await this.usablePlate(ctx, b.fileId, b.plate);
    const rules = await this.settings.get("revision");
    await this.work.run(async (u) => {
      const o = await this.lockMine(u, ctx, orderId, b.expectedStatus);
      const active = await this.version(u, o.activeVersionId);
      const [{ last }] = await u.tx.select({ last: sql<number>`max(${orderVersions.n})::int` }).from(orderVersions).where(eq(orderVersions.orderId, o.id));
      const base = { orderId: o.id, n: last + 1, fileId: b.fileId, ...plateColumns(plate, plateCount) };

      if (o.status === "PENDING_REVIEW" && o.sortKey === null) {
        /* Not approved yet: the new file simply takes the place of the old one. */
        const [v] = await u.tx
          .insert(orderVersions)
          .values({ ...base, kind: "REPLACE" })
          .returning();
        await this.decide(u, ctx, active.id, "REPLACED");
        await u.tx.update(orders).set({ activeVersionId: v.id }).where(eq(orders.id, o.id));
        await record(u, ctx, { orderId: o.id, kind: "version.replaced", versionN: v.n });
      } else if (o.status === "QUEUED") {
        const change = this.judgeRevision(o, active, plate, rules);
        const [v] = await u.tx
          .insert(orderVersions)
          .values({ ...base, kind: "REVISION", ...change })
          .returning();
        /* Reviewed again; meanwhile the order keeps its place but cannot be dispatched. */
        await u.tx.update(orders).set({ status: "PENDING_REVIEW", pendingVersionId: v.id }).where(eq(orders.id, o.id));
        await record(u, ctx, { orderId: o.id, kind: "version.revised", from: "QUEUED", to: "PENDING_REVIEW", versionN: v.n, data: change });
        u.queue = true;
      } else if (o.status === "DISPATCHED") throw ruleViolation("already dispatched: ask staff to stop it first, then revise once it is back in the queue", { rule: "dispatched" });
      else throw stateConflict(o.status);
      await u.tx.update(files).set({ submittedAt: new Date() }).where(eq(files.id, b.fileId));
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  /** Whether a revision is allowed, and what it costs: each one is compared with the version approved last, not with earlier ones. */
  private judgeRevision(o: OrderRow, active: VersionRow, next: Pick<StoredPlate, "modelId" | "nozzles" | "printSeconds">, r: SectionValues<"revision">) {
    if (!r.enabled) throw ruleViolation("revisions are switched off", { rule: "revisions_off" });
    if (o.revisionCount >= r.maxCount) throw ruleViolation("no revisions left", { rule: "revision_limit", limit: r.maxCount });
    const modelSwitch = next.modelId !== active.modelId;
    if (modelSwitch && o.modelSwitchCount >= r.modelSwitchMax) throw ruleViolation("the printer model cannot be changed again", { rule: "model_switch_limit", limit: r.modelSwitchMax });
    const deltaSeconds = next.printSeconds - active.printSeconds;
    const toEnd = modelSwitch && r.modelSwitchPlace === "END";
    const dualToSingle = modelSwitch && (active.nozzles as unknown[]).length > 1 && next.nozzles.length === 1;
    return {
      deltaSeconds,
      /* -1 = straight to the end of the queue, nothing else added on top. */
      placesBack: toEnd ? -1 : placesBackFor(deltaSeconds, r) + (modelSwitch ? r.modelSwitchExtraPlaces : 0),
      counted: !dualToSingle || r.dualToSingleCounts,
      modelSwitch,
    };
  }

  async withdraw(ctx: Ctx, orderId: string, b: { expectedStatus: OrderStatus; versionId: string }) {
    await this.work.run(async (u) => {
      const o = await this.lockMine(u, ctx, orderId, "PENDING_REVIEW");
      if (!o.pendingVersionId) throw stateConflict(o.status);
      if (o.pendingVersionId !== b.versionId) throw new Problem(409, "version_conflict", "that is not the version awaiting review", { currentVersion: o.pendingVersionId });
      const v = await this.version(u, o.pendingVersionId);
      await this.decide(u, ctx, v.id, "WITHDRAWN");
      await u.tx.update(orders).set({ status: "QUEUED", pendingVersionId: null }).where(eq(orders.id, o.id));
      await record(u, ctx, { orderId: o.id, kind: "version.withdrawn", from: "PENDING_REVIEW", to: "QUEUED", versionN: v.n });
      u.queue = true;
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  /** Going back to a version that was approved before: a new version, counted as a revision, approved without another review. */
  async restore(ctx: Ctx, orderId: string, n: number, b: { expectedStatus: OrderStatus }) {
    const rules = await this.settings.get("revision");
    await this.work.run(async (u) => {
      await lockQueue(u);
      const o = await this.lockMine(u, ctx, orderId, "QUEUED");
      if (b.expectedStatus !== "QUEUED") throw stateConflict(o.status, b.expectedStatus);
      const [from] = await u.tx
        .select()
        .from(orderVersions)
        .where(and(eq(orderVersions.orderId, o.id), eq(orderVersions.n, n)));
      if (!from) throw notFound("version");
      if (from.state !== "APPROVED") throw ruleViolation("only a version that was approved can be restored", { rule: "never_approved" });
      if (from.id === o.activeVersionId) throw ruleViolation("that is the current version", { rule: "already_current" });
      const [file] = await u.tx.select({ purgedAt: files.purgedAt }).from(files).where(eq(files.id, from.fileId));
      if (file.purgedAt) throw new Problem(410, "file_expired", "the file of that version is no longer kept");
      const active = await this.version(u, o.activeVersionId);
      const change = this.judgeRevision(o, active, { modelId: from.modelId, nozzles: from.nozzles as StoredPlate["nozzles"], printSeconds: from.printSeconds }, rules);
      const [{ last }] = await u.tx.select({ last: sql<number>`max(${orderVersions.n})::int` }).from(orderVersions).where(eq(orderVersions.orderId, o.id));
      const { id: _id, n: _n, createdAt: _c, decidedAt: _d, decidedBy: _b, reason: _r, ...copy } = from;
      const [v] = await u.tx
        .insert(orderVersions)
        .values({ ...copy, n: last + 1, kind: "RESTORE", restoredFromId: from.id, state: "APPROVED", decidedAt: new Date(), ...change })
        .returning();
      await u.tx
        .update(orders)
        .set({ activeVersionId: v.id, revisionCount: o.revisionCount + (v.counted ? 1 : 0), modelSwitchCount: o.modelSwitchCount + (v.modelSwitch ? 1 : 0) })
        .where(eq(orders.id, o.id));
      await record(u, ctx, { orderId: o.id, kind: "version.restored", versionN: v.n, data: { fromN: from.n, ...change } });
      await this.applyMoveBack(u, ctx, o, v);
    });
    return this.detail(ctx, orderId);
  }

  /* ───────── cancelling, reprinting ───────── */

  /** Only before dispatch. Once a printer has the order, it has to be stopped there first; a failed print can only be reprinted. */
  async cancel(ctx: Ctx, orderId: string, b: { expectedStatus: OrderStatus; reason: string; reasonVisible?: boolean }) {
    await this.work.run(async (u) => {
      const [seen] = await u.tx.select({ ownerId: orders.ownerId }).from(orders).where(eq(orders.id, orderId));
      const mine = seen?.ownerId === userIdOf(ctx);
      if (!seen || (!mine && !can(ctx, "order:cancel:any"))) throw notFound("order");
      if (mine && !can(ctx, "order:cancel:own") && !can(ctx, "order:cancel:any")) throw notFound("order");
      const o = await this.lock(u, orderId, b.expectedStatus);
      if (o.status === "DISPATCHED") throw ruleViolation("already dispatched: ask staff to stop it first, then cancel once it is back in the queue", { rule: "dispatched" });
      if (o.status !== "PENDING_REVIEW" && o.status !== "QUEUED") throw ruleViolation(`an order that is ${o.status} cannot be cancelled`, { rule: "not_cancellable", current: o.status });
      /* A version still waiting for review is withdrawn along with the order. */
      const pending = o.pendingVersionId ?? (o.sortKey === null ? o.activeVersionId : null);
      if (pending) await this.decide(u, ctx, pending, "WITHDRAWN");
      await this.close(u, o, "CANCELLED", { pendingVersionId: null });
      await record(u, ctx, { orderId: o.id, kind: "order.cancelled", node: o.sortKey === null ? "REVIEW" : "QUEUE", from: o.status, to: "CANCELLED", note: b.reason, noteVisible: b.reasonVisible ?? true });
    });
    return this.detail(ctx, orderId);
  }

  /** A failed print goes back to the place it had in the queue; version, file and revision count stay as they are. */
  async reprint(ctx: Ctx, orderId: string, b: { note?: string | null }) {
    await this.work.run(async (u) => {
      await lockQueue(u);
      const [seen] = await u.tx.select({ printerId: orders.printerId }).from(orders).where(eq(orders.id, orderId));
      if (seen?.printerId) await lockPrinter(u, seen.printerId);
      const o = await this.lock(u, orderId, "FAILED");
      if (o.archivedAt) throw ruleViolation("the order was archived", { rule: "archived" });
      if (o.reprintDeclinedAt) throw ruleViolation("marked as not to be reprinted", { rule: "declined" });
      const [file] = await u.tx.select({ purgedAt: files.purgedAt }).from(orderVersions).innerJoin(files, eq(files.id, orderVersions.fileId)).where(eq(orderVersions.id, o.activeVersionId));
      if (file.purgedAt || (o.filesExpireAt && o.filesExpireAt < new Date())) throw ruleViolation("the file is no longer kept", { rule: "file_expired" });
      /* The printer lets go of the order; if its bed still has to be cleared, that stays. */
      await u.tx.update(orders).set({ status: "QUEUED", printerId: null, currentJobId: null, closedAt: null, filesExpireAt: null }).where(eq(orders.id, o.id));
      await record(u, ctx, { orderId: o.id, kind: "order.reprinted", from: "FAILED", to: "QUEUED", note: b.note, noteVisible: true });
      if (o.printerId) u.printers.add(o.printerId);
      u.queue = true;
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  /** "Not reprinting, please submit again": for failures on the applicant's side. The order stays failed. */
  async declineReprint(ctx: Ctx, orderId: string, b: { reason: string; reasonVisible?: boolean }) {
    await this.work.run(async (u) => {
      const o = await this.lock(u, orderId, "FAILED");
      if (o.archivedAt || o.reprintDeclinedAt) throw stateConflict(o.archivedAt ? "ARCHIVED" : "DECLINED");
      const visible = b.reasonVisible ?? true;
      await u.tx.update(orders).set({ reprintDeclinedAt: new Date(), reprintDeclinedBy: userIdOf(ctx), reprintDeclinedReason: b.reason, reprintDeclinedReasonVisible: visible }).where(eq(orders.id, o.id));
      await record(u, ctx, { orderId: o.id, kind: "reprint.declined", note: b.reason, noteVisible: visible });
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  async revokeReprintDecline(ctx: Ctx, orderId: string) {
    await this.work.run(async (u) => {
      const o = await this.lock(u, orderId, "FAILED");
      if (o.archivedAt || !o.reprintDeclinedAt) throw stateConflict(o.archivedAt ? "ARCHIVED" : "NOT_DECLINED");
      await u.tx.update(orders).set({ reprintDeclinedAt: null, reprintDeclinedBy: null, reprintDeclinedReason: null, reprintDeclinedReasonVisible: true }).where(eq(orders.id, o.id));
      await record(u, ctx, { orderId: o.id, kind: "reprint.decline_revoked" });
      await this.audit.record(ctx, { action: "order.reprint_decline_revoke", targetType: "order", targetId: o.id, before: { reason: o.reprintDeclinedReason } }, u.tx);
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  /** A note on a print that was stopped at the printer itself, where the panel has no reason on record. */
  async addDeviceStopNote(ctx: Ctx, orderId: string, b: { refRecordId: string; note: string; noteVisible?: boolean }) {
    const id = await this.work.run(async (u) => {
      const [ref] = await u.tx
        .select()
        .from(orderRecords)
        .where(and(eq(orderRecords.id, b.refRecordId), eq(orderRecords.orderId, orderId)));
      if (!ref) throw notFound("record");
      if (ref.kind !== "print.stopped_on_device") throw ruleViolation("notes can only be added to a stop made at the printer", { rule: "not_a_device_stop" });
      await record(u, ctx, { orderId, kind: "note.added", jobId: ref.jobId, note: b.note, noteVisible: b.noteVisible ?? false, data: { refRecordId: ref.id } });
      const [r] = await u.tx.select({ id: orderRecords.id }).from(orderRecords).where(eq(orderRecords.orderId, orderId)).orderBy(desc(orderRecords.id)).limit(1);
      return r.id;
    });
    return (await this.records(ctx, orderId)).find((r) => r.id === id)!;
  }

  /* ───────── storing and disposing ───────── */

  /**
   * The print is taken off the bed and put on a shelf. If its printer is waiting for exactly this,
   * the printer becomes available in the same transaction; if the printer needs attention for
   * something else, only the order is stored and the bed is confirmed separately later.
   */
  async store(ctx: Ctx, orderId: string, b: { slot: string; photo: { data: Uint8Array; contentType: string } }) {
    const photoKey = `store-photos/${orderId}.${b.photo.contentType === "image/png" ? "png" : b.photo.contentType === "image/webp" ? "webp" : "jpg"}`;
    const [seen] = await this.db.select({ status: orders.status, printerId: orders.printerId }).from(orders).where(eq(orders.id, orderId));
    if (!seen) throw notFound("order");
    if (seen.status !== "PRINTED") throw stateConflict(seen.status, "PRINTED");
    await this.storage.put(photoKey, b.photo.data, b.photo.contentType);
    await this.work.run(async (u) => {
      const p = seen.printerId ? await lockPrinter(u, seen.printerId) : undefined;
      const o = await this.lock(u, orderId, "PRINTED");
      await u.tx.update(orders).set({ status: "READY", storageSlot: b.slot, storePhotoKey: photoKey, printerId: null }).where(eq(orders.id, o.id));
      await record(u, ctx, { orderId: o.id, kind: "order.stored", from: "PRINTED", to: "READY", jobId: o.currentJobId, noteVisible: true, data: { slot: b.slot } });
      if (p && p.state === "CLEARING_REQUIRED" && p.currentJobId === o.currentJobId) {
        await u.tx.update(printers).set({ state: "AVAILABLE", stateSince: new Date(), currentJobId: null }).where(eq(printers.id, p.id));
        await settlePrinter(u, p.id);
      } else if (p) u.printers.add(p.id);
      u.todo = true;
    });
    return this.detail(ctx, orderId);
  }

  /** Written off by staff: a print nobody collected, or one that cannot be handed out. */
  async dispose(ctx: Ctx, orderId: string, b: { expectedStatus: OrderStatus; reason: string; reasonVisible?: boolean }) {
    await this.work.run(async (u) => {
      const o = await this.lock(u, orderId, b.expectedStatus);
      if (o.status !== "READY") throw ruleViolation(`an order that is ${o.status} cannot be disposed of`, { rule: "not_disposable", current: o.status });
      await this.close(u, o, "DISPOSED");
      await record(u, ctx, { orderId: o.id, kind: "order.disposed", from: o.status, to: "DISPOSED", note: b.reason, noteVisible: b.reasonVisible ?? true });
      await this.audit.record(ctx, { action: "order.dispose", targetType: "order", targetId: o.id, reason: b.reason }, u.tx);
    });
    return this.detail(ctx, orderId);
  }

  /** Marks a collected order completed. Called by the pickup service inside its transaction. */
  async complete(u: Uow, ctx: Ctx, orderId: string): Promise<OrderRow> {
    const o = await this.lock(u, orderId, "READY");
    await this.close(u, o, "COMPLETED");
    await record(u, ctx, { orderId: o.id, kind: "order.redeemed", from: "READY", to: "COMPLETED", noteVisible: true });
    return o;
  }

  /* ───────── queue ───────── */

  async queue(ctx: Ctx) {
    const rows = await this.views.queueRows();
    const summaries = await this.views.summaries(ctx, rows);
    return rows.map((o, i) => ({ order: summaries[i], sortKey: String(o.sortKey), frozen: o.status === "PENDING_REVIEW", bypassedSince: o.bypassedSince?.toISOString() ?? null }));
  }

  /** Staff drag an order to another place. Only the audit log remembers; applicants are not told. */
  async reorder(ctx: Ctx, b: { orderId: string; afterOrderId: string | null; expectedStatus: OrderStatus }) {
    await this.work.run(async (u) => {
      await lockQueue(u);
      const o = await this.lock(u, b.orderId, b.expectedStatus);
      if (o.sortKey === null || (o.status !== "QUEUED" && o.status !== "PENDING_REVIEW")) throw stateConflict(o.status);
      if (b.afterOrderId === o.id) return;
      if (b.afterOrderId) {
        const [after] = await u.tx.select({ status: orders.status, sortKey: orders.sortKey }).from(orders).where(eq(orders.id, b.afterOrderId));
        if (!after || after.sortKey === null || (after.status !== "QUEUED" && after.status !== "PENDING_REVIEW")) throw ruleViolation("the order to place after is not in the queue", { rule: "not_in_queue" });
      }
      const key = await placeAfter(u, o.id, b.afterOrderId);
      await this.audit.record(ctx, { action: "queue.reorder", targetType: "order", targetId: o.id, before: { sortKey: String(o.sortKey) }, after: { sortKey: String(key), afterOrderId: b.afterOrderId } }, u.tx);
      u.orders.add(o.id);
    });
    return this.queue(ctx);
  }

  /** Jobs of an order, newest first. */
  async jobsOf(orderId: string) {
    return this.db.select().from(printJobs).where(eq(printJobs.orderId, orderId)).orderBy(desc(printJobs.attempt));
  }
}
