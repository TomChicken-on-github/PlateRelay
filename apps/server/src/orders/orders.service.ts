import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  type ColourPref,
  type FailureAttribution,
  type OrderDetail,
  type OrderPreview,
  type OrderStatus,
  type OrderView,
  type OverviewStats,
  OWNER_CANCELLABLE,
  type OrderVersionView,
  type PlateInfo,
  type QueueRules,
  type RevisionInfo,
} from "@platerelay/shared";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, type SQL, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, can, userId } from "../auth/actor.js";
import { sha256 } from "../auth/tokens.js";
import { ApiError, notFound } from "../common/errors.js";
import { uuidv7 } from "../common/uuid.js";
import { DB, type Db } from "../db/db.js";
import { files, orderEvents, orders, orderVersions, pickupCodes, printers } from "../db/schema.js";
import { FormsService } from "../forms/forms.service.js";
import { Gcode3mfService } from "../gcode3mf/gcode3mf.service.js";
import { PRINTER_COMMANDS, type PrinterCommands, PrinterUnreachable } from "../printers/commands.js";
import { availability, waitReason } from "../printers/compat.js";
import { lockPrinter, movePrinter, pausedMs, type PrinterRow } from "../printers/printer-state.js";
import { SchedulerService } from "../printers/scheduler.service.js";
import { QUEUE_POLICY, type QueuePolicy, type RevisionDecision } from "../rules/queue-policy.js";
import { type Offer, ResourcesService } from "../rules/resources.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { STORAGE, type ObjectStorage } from "../storage/storage.js";
import { lockQueue, moveInQueue } from "./queue.js";
import { type OrderRow, orderEvent, transition } from "./transition.js";
import { addVersion, currentOf, decide, lastApproved, pendingOf, type VersionFields, type VersionRow, versionFields, versionsOf } from "./versions.js";
import { loadPeople, orderViews, THUMB_TTL_S, type ViewExtras } from "./views.js";

/** Submit-page choices besides the form: 颜色要求 and, when allowed, the build plate. */
export interface SubmitChoices {
  colourPref: ColourPref;
  bedType: string | null;
}

/** 修改文件 for a group: what each plate of the group becomes, and the new plates. */
export interface GroupPlan {
  map: { order: number; plate: number | null }[];
  add: number[];
}

type Plate = Pick<PlateInfo, "index" | "printerModelId" | "nozzles" | "filaments">;

export interface OrderQuery {
  status?: OrderStatus[];
  q?: string;
  ownerId?: string;
  limit: number;
  offset: number;
}

const PHOTO_TYPES: [string, number[], string][] = [
  ["jpg", [0xff, 0xd8, 0xff], "image/jpeg"],
  ["png", [0x89, 0x50, 0x4e, 0x47], "image/png"],
  ["webp", [0x52, 0x49, 0x46, 0x46], "image/webp"],
];

/** Revision counts a superseded or withdrawn version gives back. */
function refund(o: OrderRow, pending: VersionRow[]) {
  return {
    revisionCount: o.revisionCount - pending.filter((v) => v.counted).length,
    modelSwitchCount: o.modelSwitchCount - pending.filter((v) => v.switched).length,
  };
}

/**
 * What a new upload is compared with: with a revision under review, the last approved version (the
 * revision is superseded and given back); otherwise the order as it is.
 */
function baseFor(o: OrderRow, versions: VersionRow[]): OrderRow {
  const pending = pendingOf(versions);
  const back = o.revision ? lastApproved(versions) : undefined;
  return { ...o, ...(back ? { ...versionFields(back), status: "QUEUED" as const } : {}), ...refund(o, pending.filter((v) => v.n > 1 || back)) };
}

@Injectable()
export class OrdersService {
  private readonly log = new Logger("Orders");

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(PRINTER_COMMANDS) private readonly commands: PrinterCommands,
    private readonly audit: AuditService,
    private readonly forms: FormsService,
    private readonly gcode3mf: Gcode3mfService,
    private readonly scheduler: SchedulerService,
    private readonly settings: SettingsService,
    private readonly resources: ResourcesService,
    @Inject(QUEUE_POLICY) private readonly policy: QueuePolicy,
  ) {}

  /* ---------- reading ---------- */

  async views(ctx: Ctx, rows: OrderRow[], extra: Pick<ViewExtras, "missingColours"> = {}): Promise<OrderView[]> {
    const queue = await this.scheduler.queuePositions();
    const rules = await this.settings.get("queue.rules");
    const queued = rows.filter((r) => r.status === "QUEUED");
    const waitReasons = new Map<number, string | null>();
    if (queued.length) {
      const fleet = await this.openFleet();
      for (const r of queued) waitReasons.set(r.id, waitReason(r, fleet));
    }
    const views = await orderViews(this.db, this.storage, ctx, rows, { queue, waitReasons, rules, ...extra });
    const previewIds = new Set(views.filter((v) => !v.isMine && v.thumbUrl).map((v) => v.id));
    if (previewIds.size) {
      await this.db.transaction(async (tx) => {
        for (const id of previewIds) await this.audit.record(ctx, { action: "order.preview.view", targetType: "order", targetId: id }, tx);
      });
    }
    return views;
  }

  async mine(ctx: Ctx): Promise<OrderView[]> {
    const rows = await this.db.select().from(orders).where(eq(orders.ownerId, userId(ctx)!)).orderBy(desc(orders.submittedAt), asc(orders.plateIndex));
    return this.views(ctx, rows);
  }

  /** Printers that take queued orders: the ones open to submitters (开放给选手). */
  private openFleet() {
    return this.db.select().from(printers).where(eq(printers.openToContestants, true));
  }

  /**
   * Shared review pool (brief §0.9 #6): revisions first, since they hold a place in the queue (rules doc
   * §3.3), then oldest first like the queue.
   */
  async reviewPool(ctx: Ctx): Promise<OrderDetail[]> {
    const rows = await this.db
      .select()
      .from(orders)
      .where(eq(orders.status, "PENDING_REVIEW"))
      .orderBy(sql`${orders.revision} is null`, asc(orders.submittedAt), asc(orders.id));
    const exact = rows.filter((r) => r.colourPref === "exact");
    const missingColours = new Map<number, string[]>();
    if (exact.length) {
      const offer = await this.resources.offer();
      for (const r of exact) missingColours.set(r.id, this.resources.check(offer, r).missingColours);
    }
    const views = await this.views(ctx, rows, { missingColours });
    const versions = await this.versionViews(rows);
    return views.map((v, i) => ({ ...v, answers: rows[i].answers.map((a) => ({ label: a.label, value: a.value })), timeline: [], versions: versions.get(v.id) ?? [] }));
  }

  async list(ctx: Ctx, q: OrderQuery) {
    const where: SQL[] = [];
    if (q.status?.length) where.push(inArray(orders.status, q.status));
    if (q.ownerId) where.push(eq(orders.ownerId, q.ownerId));
    if (q.q) {
      const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const conds: SQL[] = [inArray(orders.fileId, this.db.select({ id: files.id }).from(files).where(ilike(files.fileName, like)))];
      const n = Number(q.q.replace(/^#/, ""));
      if (Number.isInteger(n) && n > 0) conds.push(eq(orders.id, n));
      where.push(or(...conds)!);
    }
    const rows = await this.db
      .select()
      .from(orders)
      .where(and(...where))
      .orderBy(desc(orders.submittedAt), asc(orders.plateIndex))
      .limit(q.limit)
      .offset(q.offset);
    const counts = await this.db.select({ status: orders.status, n: count() }).from(orders).groupBy(orders.status);
    return { orders: await this.views(ctx, rows), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<OrderStatus, number>> };
  }

  async detail(ctx: Ctx, id: number): Promise<OrderDetail> {
    const [r] = await this.db.select().from(orders).where(eq(orders.id, id));
    if (!r) throw notFound("订单");
    const mine = r.ownerId === userId(ctx);
    if (!mine && !can(ctx, "order:view:any")) {
      await this.audit.record(ctx, { action: "order.view", targetType: "order", targetId: id, result: "denied" });
      throw notFound("订单");
    }
    const [v] = await this.views(ctx, [r]);
    const events = await this.db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(asc(orderEvents.at), asc(orderEvents.id));
    const people = await loadPeople(this.db, events.map((e) => e.actorId));
    const operate = can(ctx, "printer:operate");
    const photo = r.storePhotoKey && (mine || can(ctx, "order:view:any")) ? await this.storage.signedUrl(r.storePhotoKey, THUMB_TTL_S) : null;
    const versions = mine || can(ctx, "order:review") || can(ctx, "order:view:any") ? ((await this.versionViews([r])).get(id) ?? []) : null;
    return {
      ...v,
      versions,
      storePhotoUrl: photo,
      answers: mine || can(ctx, "order:review") || can(ctx, "order:view:any") ? r.answers.map((a) => ({ label: a.label, value: a.value })) : null,
      timeline: events.map((e) => ({
        at: e.at.toISOString(),
        kind: e.kind,
        from: e.fromStatus,
        to: e.toStatus,
        by: e.actorType === "user" ? (e.actorId === r.ownerId ? people.owner(ctx, e.actorId!).name : (people.get(e.actorId)?.name ?? null)) : null,
        /* error details stay with people who handle printers */
        data: e.kind === "error-paused" && !operate ? null : e.data,
      })),
    };
  }

  /** 版本记录 of each order, oldest first, with signed previews. */
  private async versionViews(rows: OrderRow[]): Promise<Map<number, OrderVersionView[]>> {
    const out = new Map<number, OrderVersionView[]>();
    if (!rows.length) return out;
    const vs = await this.db
      .select({ v: orderVersions, fileName: files.fileName, sizeBytes: files.sizeBytes })
      .from(orderVersions)
      .innerJoin(files, eq(files.id, orderVersions.fileId))
      .where(inArray(orderVersions.orderId, rows.map((r) => r.id)))
      .orderBy(desc(orderVersions.n));
    for (const r of rows) {
      const mine = vs.filter((x) => x.v.orderId === r.id);
      const cur = currentOf(mine.map((x) => x.v));
      const list: OrderVersionView[] = [];
      for (const { v, fileName, sizeBytes } of mine.reverse()) {
        list.push({
          n: v.n,
          kind: v.kind,
          restoredFrom: v.restoredFrom,
          state: v.state,
          current: v.n === cur?.n,
          fileName,
          sizeBytes,
          plate: { index: v.plateIndex, count: v.plateCount, name: v.plateName },
          printerModel: v.printerModel,
          printerModelId: v.printerModelId,
          nozzles: v.nozzles,
          filaments: v.filaments,
          printSeconds: v.printSeconds,
          weightGrams: v.weightGrams,
          thumbUrl: v.thumbnailKey ? await this.storage.signedUrl(v.thumbnailKey, THUMB_TTL_S) : null,
          at: v.createdAt.toISOString(),
          reason: v.reason,
        });
      }
      out.set(r.id, list);
    }
    return out;
  }

  /** Signed link to the uploaded file. Opening someone else's model is a sensitive read and is audited. */
  async fileUrl(ctx: Ctx, id: number): Promise<string> {
    const [r] = await this.db.select({ ownerId: orders.ownerId, key: files.key, name: files.fileName }).from(orders).innerJoin(files, eq(files.id, orders.fileId)).where(eq(orders.id, id));
    if (!r) throw notFound("订单");
    const mine = r.ownerId === userId(ctx);
    if (!mine && !can(ctx, "order:view:any") && !can(ctx, "order:review")) {
      await this.audit.record(ctx, { action: "order.file.download", targetType: "order", targetId: id, result: "denied", reason: "missing-permission" });
      throw notFound("订单");
    }
    const url = await this.storage.signedUrl(r.key, 300, r.name);
    if (!mine) await this.audit.record(ctx, { action: "order.file.download", targetType: "order", targetId: id });
    return url;
  }

  /* ---------- submitting ---------- */

  /** What the submit page shows before anything is stored: plates, whether the fleet can print them, the queue. */
  async preview(fileName: string, data: Buffer): Promise<OrderPreview> {
    const parsed = this.gcode3mf.parse(fileName, data);
    const offer = await this.resources.offer();
    const queued = await this.db.select({ s: orders.printSeconds }).from(orders).where(eq(orders.status, "QUEUED"));
    return {
      ...parsed,
      plates: parsed.plates.map((p) => ({
        ...p,
        availability: availability({ printerModel: parsed.printerModel, printerModelId: p.printerModelId, nozzles: p.nozzles }, offer.open),
        check: this.resources.check(offer, { ...p, printerModel: parsed.printerModel }),
      })),
      queue: { length: queued.length, aheadSeconds: queued.reduce((a, o) => a + o.s, 0) },
    };
  }

  /** The numbers on top of 概况. */
  async overview(): Promise<OverviewStats> {
    const counts = await this.db.select({ status: orders.status, n: count() }).from(orders).where(inArray(orders.status, ["PENDING_REVIEW", "QUEUED"])).groupBy(orders.status);
    const queued = await this.db.select({ printerModel: orders.printerModel, printerModelId: orders.printerModelId, nozzles: orders.nozzles }).from(orders).where(eq(orders.status, "QUEUED"));
    const fleet = await this.openFleet();
    const awaiting = await this.db.select({ id: orders.id }).from(orders).where(eq(orders.status, "PRINTED_AWAITING_STORAGE"));
    const awaitingIds = new Set(awaiting.map((o) => o.id));
    /* same items as GET /todo: plates to store, beds to clear with nothing to store, errors, passed-over orders */
    const todo = awaiting.length + fleet.filter((p) => p.state === "ERROR_PAUSED" || (p.state === "CLEARING_REQUIRED" && !(p.currentOrderId != null && awaitingIds.has(p.currentOrderId)))).length;
    const rules = await this.settings.get("queue.rules");
    const now = new Date();
    const skipped = (await this.db.select().from(orders).where(and(eq(orders.status, "QUEUED"), isNotNull(orders.skippedSince)))).filter((o) => this.policy.remindSkipped(rules, o, now)).length;
    const n = (s: OrderStatus) => counts.find((c) => c.status === s)?.n ?? 0;
    return { pendingReview: n("PENDING_REVIEW"), queued: n("QUEUED"), waitingCompatible: queued.filter((o) => waitReason(o, fleet) !== null).length, todo: todo + skipped };
  }

  /**
   * One order per plate, all PENDING_REVIEW (brief §5.3). `plates` picks which
   * plates of the file to submit (1-based, as in the slicer); all of them when absent.
   */
  async submit(ctx: Ctx, fileName: string, data: Buffer, rawAnswers: unknown, plates: number[] | undefined, choices: SubmitChoices): Promise<OrderView[]> {
    const parsed = this.gcode3mf.read(fileName, data);
    const unknown = plates?.filter((n) => !parsed.plates.some((p) => p.index === n)) ?? [];
    if (unknown.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", `文件里没有第 ${unknown.join("、")} 盘`, { plates: unknown });
    if (plates && !plates.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", "至少要选一盘");
    const info = plates ? { ...parsed, plates: parsed.plates.filter((p) => plates.includes(p.index)) } : parsed;
    const rules = await this.settings.get("queue.rules");
    if (choices.bedType && !rules.allowPlateChoice) throw new ApiError(HttpStatus.BAD_REQUEST, "plate-choice-disabled", "本场不能自选热床板");
    await this.assertOnOffer(await this.resources.offer(), info.printerModel, info.plates, choices.colourPref);
    const form = await this.forms.current();
    const answers = this.forms.answer(form, rawAnswers);
    const fileId = uuidv7();
    const fileKey = `uploads/${fileId}.gcode.3mf`;
    const written: string[] = [];
    try {
      await this.storage.put(fileKey, data, "application/vnd.bambulab-gcode-3mf");
      written.push(fileKey);
      const thumbs = new Map<number, string>();
      for (const p of info.plates) {
        if (!p.thumbnail) continue;
        const key = `plates/${fileId}/${p.index}.png`;
        await this.storage.put(key, p.thumbnail, "image/png");
        written.push(key);
        thumbs.set(p.index, key);
      }
      const rows = await this.db.transaction(async (tx) => {
        await tx.insert(files).values({ id: fileId, sha256: sha256(data), key: fileKey, fileName, sizeBytes: data.byteLength, uploadedBy: userId(ctx)! });
        const created: OrderRow[] = [];
        for (const p of info.plates) {
          const [o] = await tx
            .insert(orders)
            .values({
              status: "PENDING_REVIEW",
              ownerId: userId(ctx)!,
              fileId,
              groupId: fileId,
              plateIndex: p.index,
              plateCount: parsed.plates.length,
              plateName: p.name,
              printerModel: info.printerModel,
              printerModelId: p.printerModelId,
              nozzles: p.nozzles.map((n) => ({ extruder: n.extruder, side: n.side, diameter: n.diameter })),
              filaments: p.filaments.map((f) => ({ slot: f.slot, type: f.type, color: f.color, usedGrams: f.usedGrams, extruder: f.extruder })),
              printSeconds: Math.round(p.printSeconds),
              weightGrams: p.weightGrams,
              thumbnailKey: thumbs.get(p.index) ?? null,
              formVersionId: form.id,
              answers,
              colourPref: choices.colourPref,
              bedType: choices.bedType,
              originalPrintSeconds: Math.round(p.printSeconds),
            })
            .returning();
          await addVersion(tx, o.id, versionFields(o), { kind: "submit", state: "pending" });
          await orderEvent(tx, ctx, o.id, "submit", { plate: p.index, of: parsed.plates.length });
          await this.audit.record(ctx, { action: "order.submit", targetType: "order", targetId: o.id, after: { fileId, plate: p.index } }, tx);
          created.push(o);
        }
        return created;
      });
      return this.views(ctx, rows);
    } catch (e) {
      for (const k of written) await this.storage.delete(k).catch(() => undefined);
      throw e;
    }
  }

  /** Refuses plates the event cannot print (本场可用资源, rules doc §1.5): 422 plate-blocked with the reasons per plate. */
  private async assertOnOffer(offer: Offer, printerModel: string | null, plates: Plate[], colourPref: ColourPref) {
    const blocked: { plate: number; reasons: string[] }[] = [];
    for (const p of plates) {
      const c = this.resources.check(offer, { ...p, printerModel });
      const reasons = [...c.block];
      if (colourPref === "exact" && c.missingColours.length && offer.settings.colourMissing === "block") reasons.push(`本场没有这些颜色：${c.missingColours.join("、")}`);
      if (reasons.length) blocked.push({ plate: p.index, reasons });
    }
    if (!blocked.length) return;
    const msg = blocked.map((b) => `第 ${b.plate} 盘：${b.reasons.join("；")}`).join("\n");
    throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "plate-blocked", msg, { plates: blocked });
  }

  /* ---------- revising ---------- */

  /**
   * 提交后修改文件 (rules doc §3, §4): the owner replaces one plate's file. By default it goes back to
   * review frozen in its place, and on approval moves back by the time rule. A job dispatched but not
   * started is recalled first. What is allowed and how far it moves is the queue policy's call.
   * `plateIndex` picks the plate in the new file: when absent, the only plate or the same number.
   */
  async revise(ctx: Ctx, id: number, fileName: string, data: Buffer, plateIndex?: number): Promise<OrderView> {
    const cur = await this.ownOrder(ctx, id, "order.revise");
    const parsed = this.gcode3mf.read(fileName, data);
    const want = plateIndex ?? (parsed.plates.length === 1 ? parsed.plates[0].index : cur.plateIndex);
    const plate = parsed.plates.find((p) => p.index === want);
    if (!plate) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", `文件里没有第 ${want} 盘`, { plates: [want] });
    const printer = await this.dispatchedPrinter(cur);
    if (!["PENDING_REVIEW", "QUEUED"].includes(cur.status) && !printer) {
      throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "已经开始打印的订单不能修改，只能取消后重新提交", { orderId: id, status: cur.status });
    }
    const rules = await this.settings.get("queue.rules");
    const base = baseFor(cur, await versionsOf(this.db, id));
    const fileId = uuidv7();
    const thumbKey = plate.thumbnail ? `plates/${fileId}/${plate.index}.png` : null;
    const fields: VersionFields = {
      fileId,
      plateIndex: plate.index,
      plateCount: parsed.plates.length,
      plateName: plate.name,
      printerModel: parsed.printerModel,
      printerModelId: plate.printerModelId,
      nozzles: plate.nozzles.map((n) => ({ extruder: n.extruder, side: n.side, diameter: n.diameter })),
      filaments: plate.filaments.map((f) => ({ slot: f.slot, type: f.type, color: f.color, usedGrams: f.usedGrams, extruder: f.extruder })),
      printSeconds: Math.round(plate.printSeconds),
      weightGrams: plate.weightGrams,
      thumbnailKey: thumbKey,
    };
    const d = this.policy.revise(rules, base, fields, !!printer);
    if (!d.allowed) throw new ApiError(HttpStatus.CONFLICT, d.code, d.message, { orderId: id });
    await this.assertOnOffer(await this.resources.offer(), parsed.printerModel, [plate], cur.colourPref);

    const fileKey = `uploads/${fileId}.gcode.3mf`;
    const written: string[] = [];
    try {
      await this.storage.put(fileKey, data, "application/vnd.bambulab-gcode-3mf");
      written.push(fileKey);
      if (thumbKey) {
        await this.storage.put(thumbKey, plate.thumbnail!, "image/png");
        written.push(thumbKey);
      }
      const file = { id: fileId, sha256: sha256(data), key: fileKey, fileName, sizeBytes: data.byteLength, uploadedBy: userId(ctx)! };
      return await this.swap(ctx, cur, base, fields, d, printer, rules, { file });
    } catch (e) {
      for (const k of written) await this.storage.delete(k).catch(() => undefined);
      throw e;
    }
  }

  /**
   * 修改文件 for a whole submission group: the new file replaces the group's plates. `map` names, for
   * every plate of the group still before printing, the plate of the new file that replaces it (null:
   * drop it, the order is cancelled); `add` lists new plates, which become new orders of the group: reviewed,
   * then queued at the end like any new submission. Each replaced plate follows the revision rules on its own.
   */
  async reviseGroup(ctx: Ctx, id: number, fileName: string, data: Buffer, plan: GroupPlan): Promise<OrderView[]> {
    const cur = await this.ownOrder(ctx, id, "order.revise");
    const members: { o: OrderRow; printer: PrinterRow | undefined }[] = [];
    for (const o of await this.db.select().from(orders).where(and(eq(orders.groupId, cur.groupId), eq(orders.ownerId, cur.ownerId))).orderBy(asc(orders.id))) {
      const printer = await this.dispatchedPrinter(o);
      if (o.status === "PENDING_REVIEW" || o.status === "QUEUED" || printer) members.push({ o, printer });
    }
    const ids = members.map((m) => m.o.id);
    if (!ids.includes(id)) throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "已经开始打印的订单不能修改，只能取消后重新提交", { orderId: id, status: cur.status });
    const named = plan.map.map((m) => m.order);
    if (named.length !== ids.length || new Set(named).size !== named.length || named.some((x) => !ids.includes(x))) {
      throw new ApiError(HttpStatus.CONFLICT, "group-changed", "这组订单有变化，请刷新后再试", { orders: ids });
    }
    const parsed = this.gcode3mf.read(fileName, data);
    const used = [...plan.map.flatMap((m) => (m.plate == null ? [] : [m.plate])), ...plan.add];
    const unknown = used.filter((n) => !parsed.plates.some((p) => p.index === n));
    if (unknown.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", `文件里没有第 ${unknown.join("、")} 盘`, { plates: unknown });
    if (new Set(used).size !== used.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", "同一盘只能用一次");
    if (!plan.map.some((m) => m.plate != null)) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", "至少要保留一张原来的单，全部不要请直接取消");
    const rules = await this.settings.get("queue.rules");
    if (!rules.revisions.enabled) throw new ApiError(HttpStatus.CONFLICT, "revisions-disabled", "本场不允许提交后修改文件");
    const plateOf = (n: number) => parsed.plates.find((p) => p.index === n)!;
    await this.assertOnOffer(await this.resources.offer(), parsed.printerModel, used.map(plateOf), cur.colourPref);

    const fileId = uuidv7();
    const thumbs = new Map<number, string>();
    const fieldsOf = (n: number): VersionFields => {
      const p = plateOf(n);
      return {
        fileId,
        plateIndex: p.index,
        plateCount: parsed.plates.length,
        plateName: p.name,
        printerModel: parsed.printerModel,
        printerModelId: p.printerModelId,
        nozzles: p.nozzles.map((x) => ({ extruder: x.extruder, side: x.side, diameter: x.diameter })),
        filaments: p.filaments.map((f) => ({ slot: f.slot, type: f.type, color: f.color, usedGrams: f.usedGrams, extruder: f.extruder })),
        printSeconds: Math.round(p.printSeconds),
        weightGrams: p.weightGrams,
        thumbnailKey: thumbs.get(n) ?? (p.thumbnail ? `plates/${fileId}/${n}.png` : null),
      };
    };
    const swaps: { o: OrderRow; printer: PrinterRow | undefined; base: OrderRow; fields: VersionFields; d: Extract<RevisionDecision, { allowed: true }> }[] = [];
    for (const m of plan.map) {
      if (m.plate == null) continue;
      const { o, printer } = members.find((x) => x.o.id === m.order)!;
      const base = baseFor(o, await versionsOf(this.db, o.id));
      const fields = fieldsOf(m.plate);
      const d = this.policy.revise(rules, base, fields, !!printer);
      if (!d.allowed) throw new ApiError(HttpStatus.CONFLICT, d.code, `#${o.id}：${d.message}`, { orderId: o.id });
      swaps.push({ o, printer, base, fields, d });
    }

    const fileKey = `uploads/${fileId}.gcode.3mf`;
    const written: string[] = [];
    const recalls: [string, number][] = [];
    try {
      await this.storage.put(fileKey, data, "application/vnd.bambulab-gcode-3mf");
      written.push(fileKey);
      for (const n of used) {
        const p = plateOf(n);
        if (!p.thumbnail) continue;
        const key = `plates/${fileId}/${n}.png`;
        await this.storage.put(key, p.thumbnail, "image/png");
        written.push(key);
        thumbs.set(n, key);
      }
      const file = { id: fileId, sha256: sha256(data), key: fileKey, fileName, sizeBytes: data.byteLength, uploadedBy: userId(ctx)! };
      const rows = await this.db.transaction(async (tx) => {
        const out: OrderRow[] = [];
        for (const s of swaps) {
          const r = await this.swapIn(tx, ctx, s.o, s.base, s.fields, s.d, s.printer, rules, { file });
          if (r.recalled) recalls.push([r.recalled, s.o.id]);
          out.push(r.row);
        }
        for (const m of plan.map.filter((x) => x.plate == null)) {
          const { o, printer } = members.find((x) => x.o.id === m.order)!;
          const reason = "修改文件时移除";
          if (printer) {
            const p = await lockPrinter(tx, printer.id);
            if (p.state !== "PREPARING" || p.currentOrderId !== o.id) throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", `#${o.id} 已经开始打印，不能移除`, { orderId: o.id });
            await movePrinter(tx, p, "recalled", { currentOrderId: null });
            recalls.push([p.id, o.id]);
          }
          const { row, from } = await transition(tx, ctx, o.id, "cancelOwn", { set: { cancelledBy: userId(ctx), cancelledAt: new Date(), cancelReason: reason }, data: { reason, file: fileName } });
          await decide(tx, pendingOf(await versionsOf(tx, o.id)).map((v) => v.id), "withdrawn", userId(ctx));
          await this.audit.record(ctx, { action: "order.cancel", targetType: "order", targetId: o.id, before: { status: from }, after: { status: "CANCELLED" }, reason }, tx);
          out.push(row);
        }
        for (const n of plan.add) {
          const fields = fieldsOf(n);
          const [o] = await tx
            .insert(orders)
            .values({
              status: "PENDING_REVIEW",
              ownerId: cur.ownerId,
              groupId: cur.groupId,
              splitFrom: cur.id,
              ...fields,
              formVersionId: cur.formVersionId,
              answers: cur.answers,
              colourPref: cur.colourPref,
              bedType: cur.bedType,
              originalPrintSeconds: fields.printSeconds,
            })
            .returning();
          await addVersion(tx, o.id, fields, { kind: "submit", state: "pending" });
          await orderEvent(tx, ctx, o.id, "split", { from: cur.id, plate: n, of: parsed.plates.length });
          await this.audit.record(ctx, { action: "order.submit", targetType: "order", targetId: o.id, after: { fileId, plate: n, splitFrom: cur.id } }, tx);
          out.push(o);
        }
        return out;
      });
      for (const [p, o] of recalls) await this.sendRecall(ctx, p, o);
      void this.scheduler.kick();
      return this.views(ctx, rows);
    } catch (e) {
      for (const k of written) await this.storage.delete(k).catch(() => undefined);
      throw e;
    }
  }

  /**
   * 恢复旧版本 (rules doc §3): an approved version comes back as a new version. It counts as a
   * revision and moves by the time rule like any other, but needs no review: that file was approved.
   */
  async restore(ctx: Ctx, id: number, n: number): Promise<OrderView> {
    const cur = await this.ownOrder(ctx, id, "order.restore");
    const versions = await versionsOf(this.db, id);
    const from = versions.find((v) => v.n === n);
    if (!from) throw notFound("版本");
    if (cur.revision) throw new ApiError(HttpStatus.CONFLICT, "revision-pending", "有修改正在审核，先撤回修改再恢复", { orderId: id });
    if (from.state !== "approved") throw new ApiError(HttpStatus.CONFLICT, "version-not-approved", "只能恢复审核通过的版本", { orderId: id, n });
    if (currentOf(versions)?.n === n) throw new ApiError(HttpStatus.CONFLICT, "version-current", "这已经是当前版本", { orderId: id, n });
    const printer = await this.dispatchedPrinter(cur);
    if (cur.status !== "QUEUED" && !printer) {
      throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "这张单现在不能恢复旧版本", { orderId: id, status: cur.status });
    }
    const rules = await this.settings.get("queue.rules");
    const fields = versionFields(from);
    const d = this.policy.revise(rules, cur, fields, !!printer);
    if (!d.allowed) throw new ApiError(HttpStatus.CONFLICT, d.code, d.message, { orderId: id });
    return this.swap(ctx, cur, cur, fields, { ...d, kind: "restore", review: false }, printer, rules, { restoredFrom: n });
  }

  /** 撤回修改: free. The revision under review is dropped and the last approved version keeps its place. */
  async withdraw(ctx: Ctx, id: number): Promise<OrderView> {
    await this.ownOrder(ctx, id, "order.withdraw");
    const row = await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      const versions = await versionsOf(tx, id);
      const back = lastApproved(versions);
      const pending = pendingOf(versions);
      if (o.status !== "PENDING_REVIEW" || !o.revision || !back || !pending.length) {
        throw new ApiError(HttpStatus.CONFLICT, "nothing-to-withdraw", "没有正在审核的修改", { orderId: id, status: o.status });
      }
      await decide(tx, pending.map((v) => v.id), "withdrawn", userId(ctx));
      const { row } = await transition(tx, ctx, id, "withdraw", {
        set: { ...versionFields(back), ...refund(o, pending), revision: null },
        data: { n: pending[0].n, back: back.n },
      });
      await this.audit.record(ctx, { action: "order.withdraw", targetType: "order", targetId: id, before: { status: "PENDING_REVIEW", version: pending[0].n }, after: { status: "QUEUED", version: back.n } }, tx);
      return row;
    });
    void this.scheduler.kick();
    return (await this.views(ctx, [row]))[0];
  }

  /** Signed link to one version's file; someone else's is audited like the current file. */
  async versionFileUrl(ctx: Ctx, id: number, n: number): Promise<string> {
    const [r] = await this.db
      .select({ ownerId: orders.ownerId, key: files.key, name: files.fileName })
      .from(orderVersions)
      .innerJoin(orders, eq(orders.id, orderVersions.orderId))
      .innerJoin(files, eq(files.id, orderVersions.fileId))
      .where(and(eq(orderVersions.orderId, id), eq(orderVersions.n, n)));
    if (!r) throw notFound("版本");
    const mine = r.ownerId === userId(ctx);
    if (!mine && !can(ctx, "order:view:any") && !can(ctx, "order:review")) {
      await this.audit.record(ctx, { action: "order.file.download", targetType: "order", targetId: id, result: "denied", reason: "missing-permission" });
      throw notFound("订单");
    }
    const url = await this.storage.signedUrl(r.key, 300, r.name);
    if (!mine) await this.audit.record(ctx, { action: "order.file.download", targetType: "order", targetId: id, after: { version: n } });
    return url;
  }

  private async ownOrder(ctx: Ctx, id: number, action: string): Promise<OrderRow> {
    const [cur] = await this.db.select().from(orders).where(eq(orders.id, id));
    if (!cur || cur.ownerId !== userId(ctx)) {
      if (cur) await this.audit.record(ctx, { action, targetType: "order", targetId: id, result: "denied", reason: "not-owner" });
      throw notFound("订单");
    }
    return cur;
  }

  /** The printer an order was dispatched to and that has not started it yet. */
  private async dispatchedPrinter(o: OrderRow) {
    if (o.status !== "PRINTING" || !o.printerId) return undefined;
    const [p] = await this.db.select().from(printers).where(eq(printers.id, o.printerId));
    return p && p.state === "PREPARING" && p.currentOrderId === o.id ? p : undefined;
  }

  /**
   * Puts a new version on the order: a revised file (re-reviewed, frozen in its place, unless the policy
   * auto-approves it) or a restored one. A revision still under review is superseded and given back.
   */
  private async swap(
    ctx: Ctx,
    cur: OrderRow,
    base: OrderRow,
    fields: VersionFields,
    d: Extract<RevisionDecision, { allowed: true }>,
    printer: PrinterRow | undefined,
    rules: QueueRules,
    opts: { file?: typeof files.$inferInsert; restoredFrom?: number },
  ): Promise<OrderView> {
    let recalled: string | null = null;
    const row = await this.db.transaction(async (tx) => {
      const r = await this.swapIn(tx, ctx, cur, base, fields, d, printer, rules, opts);
      recalled = r.recalled;
      return r.row;
    });
    if (recalled) await this.sendRecall(ctx, recalled, cur.id);
    if (recalled || !d.review) void this.scheduler.kick();
    return (await this.views(ctx, [row]))[0];
  }

  private async swapIn(
    tx: Db,
    ctx: Ctx,
    cur: OrderRow,
    base: OrderRow,
    fields: VersionFields,
    d: Extract<RevisionDecision, { allowed: true }>,
    printer: PrinterRow | undefined,
    rules: QueueRules,
    opts: { file?: typeof files.$inferInsert; restoredFrom?: number },
  ): Promise<{ row: OrderRow; recalled: string | null }> {
    const id = cur.id;
    let recalled: string | null = null;
    {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");      if (o.status !== cur.status || o.fileId !== cur.fileId) throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "订单状态已变化，请刷新后再试", { orderId: id, status: o.status });
      if (printer) {
        const p = await lockPrinter(tx, printer.id);
        if (p.state !== "PREPARING" || p.currentOrderId !== id) throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "这张单已经开始打印，不能再改", { orderId: id });
        await movePrinter(tx, p, "recalled", { currentOrderId: null });
        recalled = p.id;
      }
      const [f] = await tx.select({ fileName: files.fileName }).from(files).where(eq(files.id, base.fileId));
      const superseded = pendingOf(await versionsOf(tx, id));
      await decide(tx, superseded.map((v) => v.id), "withdrawn", userId(ctx));
      if (opts.file && !(await tx.select({ id: files.id }).from(files).where(eq(files.id, opts.file.id!))).length) await tx.insert(files).values(opts.file);
      const ver = await addVersion(tx, id, fields, {
        kind: d.kind,
        state: d.review ? "pending" : "approved",
        restoredFrom: opts.restoredFrom,
        counted: d.counts,
        switched: d.isSwitch,
        decidedBy: userId(ctx),
      });
      const info: RevisionInfo = {
        n: ver.n - 1,
        kind: d.kind,
        at: new Date().toISOString(),
        prev: { fileName: f.fileName, printerModel: base.printerModel, printerModelId: base.printerModelId, nozzles: base.nozzles, filaments: base.filaments, printSeconds: base.printSeconds, weightGrams: base.weightGrams },
        deltaSeconds: d.deltaSeconds,
        placesBack: d.placesBack,
        recalled: !!printer,
      };
      const set = {
        ...fields,
        originalPrintSeconds: o.originalPrintSeconds ?? o.printSeconds,
        revisionCount: base.revisionCount + (d.counts ? 1 : 0),
        modelSwitchCount: base.modelSwitchCount + (d.isSwitch ? 1 : 0),
        printerId: null,
        startedAt: null,
        skippedSince: null,
        revision: d.review ? info : null,
      };
      const fileName = opts.file?.fileName ?? null;
      const data_ = { n: info.n, version: ver.n, kind: d.kind, file: fileName, plate: fields.plateIndex, restoredFrom: opts.restoredFrom ?? null, deltaSeconds: d.deltaSeconds, placesBack: d.placesBack, recalled: !!printer, review: d.review };
      const { row, from } = d.review
        ? await transition(tx, ctx, id, "revise", { set: { ...set, reviewedBy: null, reviewedAt: null }, data: data_ })
        : await transition(tx, ctx, id, opts.restoredFrom ? "restore" : "reviseApproved", { set, data: data_ });
      await this.audit.record(
        ctx,
        {
          action: opts.restoredFrom ? "order.restore" : "order.revise",
          targetType: "order",
          targetId: id,
          before: { status: from, fileId: o.fileId, printSeconds: o.printSeconds, printerModelId: o.printerModelId },
          after: { status: row.status, version: ver.n, fileId: fields.fileId, printSeconds: fields.printSeconds, printerModelId: fields.printerModelId, kind: d.kind, recalled },
          reason: JSON.stringify({ policy: this.policy.id, deltaSeconds: d.deltaSeconds, placesBack: d.placesBack, review: d.review, rules: { revisions: rules.revisions, modelSwitch: rules.modelSwitch } }),
        },
        tx,
      );
      /* auto-approved: it is queued again now, so it moves back now */
      return { row: !d.review && d.placesBack !== 0 ? await this.moveBack(tx, ctx, id, info) : row, recalled };
    }
  }

  /** Best effort, like sendStop: the recall is recorded; the daemon link will deliver it once it exists. */
  private async sendRecall(ctx: Ctx, printerId: string, orderId: number) {
    try {
      await this.commands.recall(printerId, orderId);
    } catch (e) {
      this.log.warn(`recall not sent to ${printerId}: ${(e as Error).message}`);
      await this.audit.record(ctx, { action: "printer.recall.command", targetType: "printer", targetId: printerId, after: { orderId }, result: "failed", reason: e instanceof PrinterUnreachable ? "printer-unreachable" : "command-failed" });
      return;
    }
    await this.audit.record(ctx, { action: "printer.recall.command", targetType: "printer", targetId: printerId, after: { orderId } });
  }

  /* ---------- review ---------- */

  /**
   * Approval queues the order. A revision keeps its place and then moves back as the policy decided
   * when it was uploaded; the move is in the audit log with the rule and its numbers (rules doc §7).
   */
  async approve(ctx: Ctx, id: number): Promise<OrderView> {
    const row = await this.db.transaction(async (tx) => {
      const [pending] = await tx.select({ revision: orders.revision }).from(orders).where(eq(orders.id, id)).for("update");
      const rev = pending?.revision ?? null;
      const { row } = await transition(tx, ctx, id, "approve", {
        set: { reviewedBy: userId(ctx), reviewedAt: new Date(), queueSeq: sql`coalesce(${orders.queueSeq}, nextval('order_queue_seq'))`, revision: null },
        data: rev ? { revision: rev.n, placesBack: rev.placesBack } : undefined,
        conflictCode: "already-reviewed",
        conflictMessage: "这张单已被他人审核",
      });
      await decide(tx, pendingOf(await versionsOf(tx, id)).map((v) => v.id), "approved", userId(ctx));
      await this.audit.record(ctx, { action: "order.approve", targetType: "order", targetId: id, before: { status: "PENDING_REVIEW" }, after: { status: "QUEUED" } }, tx);
      if (!rev || rev.placesBack === 0) return row;
      return this.moveBack(tx, ctx, id, rev);
    });
    void this.scheduler.kick();
    return (await this.views(ctx, [row]))[0];
  }

  /** Moves an approved revision back in the queue as the policy decided, and records the move with its numbers. */
  private async moveBack(tx: Db, ctx: Ctx, id: number, rev: RevisionInfo): Promise<OrderRow> {
    const q = await lockQueue(tx);
    const from = q.findIndex((o) => o.id === id);
    const to = await moveInQueue(tx, q, id, rev.placesBack === "tail" ? q.length - 1 : from + rev.placesBack);
    await this.audit.record(
      ctx,
      {
        action: "queue.revision-penalty",
        targetType: "order",
        targetId: id,
        before: { position: from + 1 },
        after: { position: to + 1 },
        reason: JSON.stringify({ policy: this.policy.id, revision: rev.n, kind: rev.kind, deltaSeconds: rev.deltaSeconds, placesBack: rev.placesBack, recalled: rev.recalled }),
      },
      tx,
    );
    return (await tx.select().from(orders).where(eq(orders.id, id)))[0];
  }

  /**
   * A rejected revision does not end the order: the last approved version keeps queueing in its place
   * and the revision stays in 版本记录 as rejected (it still counts). A plate never approved is rejected.
   */
  async reject(ctx: Ctx, id: number, reason: string): Promise<OrderView> {
    const row = await this.db.transaction(async (tx) => {
      const [o] = await tx.select({ revision: orders.revision }).from(orders).where(eq(orders.id, id)).for("update");
      const versions = await versionsOf(tx, id);
      const pending = pendingOf(versions);
      const back = o?.revision ? lastApproved(versions) : undefined;
      if (back) {
        const { row } = await transition(tx, ctx, id, "rejectRevision", {
          set: { ...versionFields(back), revision: null },
          data: { reason, n: pending[0]?.n ?? null, back: back.n },
          conflictCode: "already-reviewed",
          conflictMessage: "这张单已被他人审核",
        });
        await decide(tx, pending.map((v) => v.id), "rejected", userId(ctx), reason);
        await this.audit.record(ctx, { action: "order.reject", targetType: "order", targetId: id, before: { status: "PENDING_REVIEW", version: pending[0]?.n }, after: { status: "QUEUED", version: back.n }, reason }, tx);
        return row;
      }
      const { row } = await transition(tx, ctx, id, "reject", {
        set: { reviewedBy: userId(ctx), reviewedAt: new Date(), rejectReason: reason },
        data: { reason },
        conflictCode: "already-reviewed",
        conflictMessage: "这张单已被他人审核",
      });
      await decide(tx, pending.map((v) => v.id), "rejected", userId(ctx), reason);
      await this.audit.record(ctx, { action: "order.reject", targetType: "order", targetId: id, before: { status: "PENDING_REVIEW" }, after: { status: "REJECTED" }, reason }, tx);
      return row;
    });
    if (row.status === "QUEUED") void this.scheduler.kick();
    return (await this.views(ctx, [row]))[0];
  }

  /* ---------- cancelling ---------- */

  /**
   * Submitters cancel their own orders before printing starts; holders of
   * order:cancel:any cancel anything unfinished. Cancelling a print stops
   * the printer, which then needs its bed cleared like any other job.
   */
  async cancel(ctx: Ctx, id: number, reason: string): Promise<OrderView> {
    const [cur] = await this.db.select({ ownerId: orders.ownerId, status: orders.status }).from(orders).where(eq(orders.id, id));
    if (!cur) throw notFound("订单");
    const mine = cur.ownerId === userId(ctx);
    const any = can(ctx, "order:cancel:any");
    if (!any && !(mine && can(ctx, "order:cancel:own"))) {
      await this.audit.record(ctx, { action: "order.cancel", targetType: "order", targetId: id, reason, result: "denied" });
      if (!mine && !can(ctx, "order:view:any")) throw notFound("订单");
      throw new ApiError(HttpStatus.FORBIDDEN, "forbidden", "没有权限取消这张单");
    }
    let stopPrinter: string | null = null;
    let recallPrinter: string | null = null;
    const row = await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      const printer = o.status === "PRINTING" && o.printerId ? await lockPrinter(tx, o.printerId) : null;
      /* dispatched but still PREPARING has not started: the submitter may still cancel it */
      const early = printer?.state === "PREPARING" && printer.currentOrderId === id;
      if (!any && !OWNER_CANCELLABLE.includes(o.status) && !early) {
        throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "订单已经开始打印，不能自行取消", { orderId: id, status: o.status });
      }
      const now = new Date();
      const { row, from } = await transition(tx, ctx, id, any ? "cancelAny" : "cancelOwn", {
        set: { cancelledBy: userId(ctx), cancelledAt: now, cancelReason: reason, errorPausedMs: o.errorPausedMs + (printer ? pausedMs(printer, now) : 0) },
        data: { reason },
      });
      if (early) {
        /* nothing on the bed yet: take the job back instead of stopping a print */
        await movePrinter(tx, printer, "recalled", { currentOrderId: null });
        recallPrinter = printer.id;
      } else if (printer && printer.currentOrderId === id && printer.state !== "CLEARING_REQUIRED") {
        await movePrinter(tx, printer, "stopped", { error: null });
        stopPrinter = printer.id;
      }
      await tx.update(pickupCodes).set({ revokedAt: now }).where(and(eq(pickupCodes.orderId, id), isNull(pickupCodes.revokedAt), isNull(pickupCodes.redeemedAt)));
      await this.audit.record(ctx, { action: "order.cancel", targetType: "order", targetId: id, before: { status: from }, after: { status: "CANCELLED" }, reason }, tx);
      return row;
    });
    if (stopPrinter) await this.sendStop(ctx, stopPrinter);
    if (recallPrinter) {
      await this.sendRecall(ctx, recallPrinter, id);
      void this.scheduler.kick();
    }
    return (await this.views(ctx, [row]))[0];
  }

  /** Best effort: the decision is already recorded; someone at the printer can still stop it by hand. */
  async sendStop(ctx: Ctx, printerId: string): Promise<boolean> {
    try {
      await this.commands.stop(printerId);
    } catch (e) {
      this.log.warn(`stop not sent to ${printerId}: ${(e as Error).message}`);
      await this.audit.record(ctx, { action: "printer.stop.command", targetType: "printer", targetId: printerId, after: { command: "STOP" }, result: "failed", reason: e instanceof PrinterUnreachable ? "printer-unreachable" : "command-failed" });
      return false;
    }
    await this.audit.record(ctx, { action: "printer.stop.command", targetType: "printer", targetId: printerId, after: { command: "STOP" } });
    return true;
  }

  /* ---------- failure attribution ---------- */

  /**
   * 失败归因 on a FAILED order, which spawns its retry as a new order:
   * machine fault → straight back to the queue at the failed order's place;
   * model or slicing problem → back to review.
   */
  async attribute(ctx: Ctx, id: number, attribution: FailureAttribution, note: string | null): Promise<{ failed: OrderView; retry: OrderView }> {
    const { failed, retry } = await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
      if (!o) throw notFound("订单");
      if (o.status !== "FAILED") throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "只有打印失败的订单能归因", { orderId: id, status: o.status });
      if (o.attribution) throw new ApiError(HttpStatus.CONFLICT, "already-attributed", "这张单已经归因过了", { orderId: id, attribution: o.attribution });
      const [failed] = await tx.update(orders).set({ attribution, attributedBy: userId(ctx), attributedAt: new Date() }).where(eq(orders.id, id)).returning();
      const machine = attribution === "machine";
      const { id: _id, status: _s, submittedAt: _at, ...copy } = o;
      const [retry] = await tx
        .insert(orders)
        .values({
          ...blank(copy),
          status: machine ? "QUEUED" : "PENDING_REVIEW",
          queueSeq: machine ? o.queueSeq : null,
          reviewedBy: machine ? o.reviewedBy : null,
          reviewedAt: machine ? o.reviewedAt : null,
          retryOf: id,
          splitFrom: null,
        })
        .returning();
      await addVersion(tx, retry.id, versionFields(retry), { kind: "submit", state: machine ? "approved" : "pending", decidedBy: o.reviewedBy });
      await orderEvent(tx, ctx, id, "attribute", { attribution, note, retry: retry.id });
      await orderEvent(tx, ctx, retry.id, "retry", { retryOf: id, attribution });
      await this.audit.record(ctx, { action: "order.attribute", targetType: "order", targetId: id, after: { attribution, retry: retry.id }, reason: note }, tx);
      return { failed, retry };
    });
    void this.scheduler.kick();
    const [a, b] = await this.views(ctx, [failed, retry]);
    return { failed: a, retry: b };
  }

  /* ---------- queue ---------- */

  /**
   * Moves a queued order to another place (1-based). Hidden from submitters
   * (no timeline entry), fully kept in the audit log (brief §0.6).
   */
  async reorder(ctx: Ctx, id: number, toPosition: number, reason: string | null) {
    await this.db.transaction(async (tx) => {
      const q = await lockQueue(tx);
      const from = q.findIndex((o) => o.id === id);
      if (from < 0) throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "只能调整排队中的订单", { orderId: id });
      const to = await moveInQueue(tx, q, id, toPosition - 1);
      if (to === from) return;
      await this.audit.record(ctx, { action: "queue.reorder", targetType: "order", targetId: id, before: { position: from + 1 }, after: { position: to + 1 }, reason }, tx);
    });
  }

  /* ---------- storing ---------- */

  /**
   * 铲件入库: one action, one transaction, two transitions (brief §0.2):
   * the order becomes ready for pickup and its printer goes back to IDLE.
   */
  async store(ctx: Ctx, id: number, slot: string, photo: Buffer): Promise<OrderView> {
    const type = PHOTO_TYPES.find(([, magic]) => magic.every((b, i) => photo[i] === b));
    if (!type) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "bad-photo", "入库照片只收 JPEG、PNG、WebP");
    const key = `store-photos/${id}-${randomUUID()}.${type[0]}`;
    await this.storage.put(key, photo, type[2]);
    let row: OrderRow;
    try {
      row = await this.db.transaction(async (tx) => {
        const [o] = await tx.select({ printerId: orders.printerId }).from(orders).where(eq(orders.id, id));
        if (!o) throw notFound("订单");
        const printer = o.printerId ? await lockPrinter(tx, o.printerId) : null;
        const { row } = await transition(tx, ctx, id, "store", { set: { storedBy: userId(ctx), storedAt: new Date(), storageSlot: slot, storePhotoKey: key }, data: { slot } });
        let released = false;
        if (printer && printer.currentOrderId === id && printer.state === "CLEARING_REQUIRED") {
          await movePrinter(tx, printer, "cleared", { currentOrderId: null });
          released = true;
        }
        await this.audit.record(ctx, { action: "order.store", targetType: "order", targetId: id, after: { status: "STORED_READY_PICKUP", slot, printerReleased: released ? printer!.id : null } }, tx);
        return row;
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
    void this.scheduler.kick();
    return (await this.views(ctx, [row]))[0];
  }

}

/** A retry starts with a clean history: only the plate, file and answers carry over. */
function blank(o: Omit<OrderRow, "id" | "status" | "submittedAt">) {
  return {
    ...o,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    printerId: null,
    startedAt: null,
    printedAt: null,
    errorPausedMs: 0,
    storedBy: null,
    storedAt: null,
    storageSlot: null,
    storePhotoKey: null,
    redeemedBy: null,
    redeemedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    failedBy: null,
    failedAt: null,
    failureReason: null,
    attribution: null,
    attributedBy: null,
    attributedAt: null,
    revision: null,
    skippedSince: null,
  };
}
