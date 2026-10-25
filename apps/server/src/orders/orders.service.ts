import { randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { type FailureAttribution, type OrderDetail, type OrderPreview, type OrderStatus, type OrderView, type OverviewStats, OWNER_CANCELLABLE } from "@platerelay/shared";
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, can, userId } from "../auth/actor.js";
import { sha256 } from "../auth/tokens.js";
import { ApiError, notFound } from "../common/errors.js";
import { uuidv7 } from "../common/uuid.js";
import { DB, type Db } from "../db/db.js";
import { files, orderEvents, orders, pickupCodes, printers } from "../db/schema.js";
import { FormsService } from "../forms/forms.service.js";
import { Gcode3mfService } from "../gcode3mf/gcode3mf.service.js";
import { PRINTER_COMMANDS, type PrinterCommands, PrinterUnreachable } from "../printers/commands.js";
import { availability, waitReason } from "../printers/compat.js";
import { lockPrinter, movePrinter, pausedMs } from "../printers/printer-state.js";
import { SchedulerService } from "../printers/scheduler.service.js";
import { STORAGE, type ObjectStorage } from "../storage/storage.js";
import { type OrderRow, orderEvent, transition } from "./transition.js";
import { loadPeople, orderViews, THUMB_TTL_S } from "./views.js";

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
  ) {}

  /* ---------- reading ---------- */

  async views(ctx: Ctx, rows: OrderRow[]): Promise<OrderView[]> {
    const queue = await this.scheduler.queuePositions();
    const queued = rows.filter((r) => r.status === "QUEUED");
    const waitReasons = new Map<number, string | null>();
    if (queued.length) {
      const fleet = await this.db.select().from(printers);
      for (const r of queued) waitReasons.set(r.id, waitReason(r, fleet));
    }
    const views = await orderViews(this.db, this.storage, ctx, rows, { queue, waitReasons });
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

  /** Shared review pool, oldest first like the queue (brief §0.9 #6). */
  async reviewPool(ctx: Ctx): Promise<OrderDetail[]> {
    const rows = await this.db.select().from(orders).where(eq(orders.status, "PENDING_REVIEW")).orderBy(asc(orders.submittedAt), asc(orders.id));
    const views = await this.views(ctx, rows);
    return views.map((v, i) => ({ ...v, answers: rows[i].answers.map((a) => ({ label: a.label, value: a.value })), timeline: [] }));
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
    return {
      ...v,
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
    const fleet = await this.db.select().from(printers);
    const queued = await this.db.select({ s: orders.printSeconds }).from(orders).where(eq(orders.status, "QUEUED"));
    return {
      ...parsed,
      plates: parsed.plates.map((p) => ({ ...p, availability: availability({ printerModel: parsed.printerModel, printerModelId: p.printerModelId, nozzles: p.nozzles }, fleet) })),
      queue: { length: queued.length, aheadSeconds: queued.reduce((a, o) => a + o.s, 0) },
    };
  }

  /** The numbers on top of 概况. */
  async overview(): Promise<OverviewStats> {
    const counts = await this.db.select({ status: orders.status, n: count() }).from(orders).where(inArray(orders.status, ["PENDING_REVIEW", "QUEUED"])).groupBy(orders.status);
    const queued = await this.db.select({ printerModel: orders.printerModel, printerModelId: orders.printerModelId, nozzles: orders.nozzles }).from(orders).where(eq(orders.status, "QUEUED"));
    const fleet = queued.length ? await this.db.select().from(printers) : [];
    const n = (s: OrderStatus) => counts.find((c) => c.status === s)?.n ?? 0;
    return { pendingReview: n("PENDING_REVIEW"), queued: n("QUEUED"), waitingCompatible: queued.filter((o) => waitReason(o, fleet) !== null).length };
  }

  /**
   * One order per plate, all PENDING_REVIEW (brief §5.3). `plates` picks which
   * plates of the file to submit (1-based, as in the slicer); all of them when absent.
   */
  async submit(ctx: Ctx, fileName: string, data: Buffer, rawAnswers: unknown, plates?: number[]): Promise<OrderView[]> {
    const parsed = this.gcode3mf.read(fileName, data);
    const unknown = plates?.filter((n) => !parsed.plates.some((p) => p.index === n)) ?? [];
    if (unknown.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", `文件里没有第 ${unknown.join("、")} 盘`, { plates: unknown });
    if (plates && !plates.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-plates", "至少要选一盘");
    const info = plates ? { ...parsed, plates: parsed.plates.filter((p) => plates.includes(p.index)) } : parsed;
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
            })
            .returning();
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

  /* ---------- review ---------- */

  async approve(ctx: Ctx, id: number): Promise<OrderView> {
    const row = await this.db.transaction(async (tx) => {
      const { row } = await transition(tx, ctx, id, "approve", {
        set: { reviewedBy: userId(ctx), reviewedAt: new Date(), queueSeq: this.scheduler.nextQueueSeq() },
        conflictCode: "already-reviewed",
        conflictMessage: "这张单已被他人审核",
      });
      await this.audit.record(ctx, { action: "order.approve", targetType: "order", targetId: id, before: { status: "PENDING_REVIEW" }, after: { status: "QUEUED" } }, tx);
      return row;
    });
    void this.scheduler.kick();
    return (await this.views(ctx, [row]))[0];
  }

  async reject(ctx: Ctx, id: number, reason: string): Promise<OrderView> {
    const row = await this.db.transaction(async (tx) => {
      const { row } = await transition(tx, ctx, id, "reject", {
        set: { reviewedBy: userId(ctx), reviewedAt: new Date(), rejectReason: reason },
        data: { reason },
        conflictCode: "already-reviewed",
        conflictMessage: "这张单已被他人审核",
      });
      await this.audit.record(ctx, { action: "order.reject", targetType: "order", targetId: id, before: { status: "PENDING_REVIEW" }, after: { status: "REJECTED" }, reason }, tx);
      return row;
    });
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
    if (!any && !OWNER_CANCELLABLE.includes(cur.status)) {
      throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "订单已经开始打印，不能自行取消", { orderId: id, status: cur.status });
    }
    let stopPrinter: string | null = null;
    const row = await this.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id));
      const printer = o.status === "PRINTING" && o.printerId ? await lockPrinter(tx, o.printerId) : null;
      const now = new Date();
      const { row, from } = await transition(tx, ctx, id, any ? "cancelAny" : "cancelOwn", {
        set: { cancelledBy: userId(ctx), cancelledAt: now, cancelReason: reason, errorPausedMs: o.errorPausedMs + (printer ? pausedMs(printer, now) : 0) },
        data: { reason },
      });
      if (printer && printer.currentOrderId === id && printer.state !== "CLEARING_REQUIRED") {
        await movePrinter(tx, printer, "stopped", { error: null });
        stopPrinter = printer.id;
      }
      await tx.update(pickupCodes).set({ revokedAt: now }).where(and(eq(pickupCodes.orderId, id), isNull(pickupCodes.revokedAt), isNull(pickupCodes.redeemedAt)));
      await this.audit.record(ctx, { action: "order.cancel", targetType: "order", targetId: id, before: { status: from }, after: { status: "CANCELLED" }, reason }, tx);
      return row;
    });
    if (stopPrinter) await this.sendStop(ctx, stopPrinter);
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
        })
        .returning();
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
      const q = await tx.select({ id: orders.id, seq: orders.queueSeq }).from(orders).where(eq(orders.status, "QUEUED")).orderBy(asc(orders.queueSeq), asc(orders.id)).for("update");
      const from = q.findIndex((o) => o.id === id);
      if (from < 0) throw new ApiError(HttpStatus.CONFLICT, "order-state-conflict", "只能调整排队中的订单", { orderId: id });
      const to = Math.min(Math.max(toPosition, 1), q.length) - 1;
      if (to === from) return;
      const seqs = q.map((o) => o.seq!).sort((a, b) => a - b);
      const ids = q.map((o) => o.id);
      ids.splice(to, 0, ...ids.splice(from, 1));
      /* reuse the same keys in the new order, so new approvals still land at the end */
      for (let i = 0; i < ids.length; i++) if (q[i].id !== ids[i] || q[i].seq !== seqs[i]) await tx.update(orders).set({ queueSeq: seqs[i] }).where(eq(orders.id, ids[i]));
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
  };
}
