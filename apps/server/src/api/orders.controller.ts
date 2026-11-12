import { Body, Controller, Param, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { type Ctx, ReqCtx } from "../common/ctx.js";
import { Op } from "../common/op.js";
import { validationFailed } from "../common/problem.js";
import { FilesService } from "../files/files.service.js";
import { OrdersService } from "../orders/orders.service.js";
import { PickupService } from "../orders/pickup.service.js";
import type { OrderStatus } from "../orders/records.js";
import { DispatchService } from "../printers/dispatch.service.js";
import { type Judgement, PrintersService } from "../printers/printers.service.js";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
type Upload = { originalname: string; buffer: Buffer; mimetype: string } | undefined;

/* Browsers send multipart file names as Latin-1 bytes; they are UTF-8 underneath. */
const fileNameOf = (f: { originalname: string }) => Buffer.from(f.originalname, "latin1").toString("utf8");

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly files: FilesService,
    private readonly pickup: PickupService,
    private readonly printers: PrintersService,
    private readonly dispatcher: DispatchService,
  ) {}

  /* ───────── files ───────── */

  @Op("uploadFile", 202)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@ReqCtx() ctx: Ctx, @UploadedFile() file: Upload) {
    if (!file) throw validationFailed([{ path: "/file", code: "required" }]);
    return this.files.upload(ctx, fileNameOf(file), file.buffer);
  }

  @Op("getFileCheck")
  fileCheck(@ReqCtx() ctx: Ctx, @Param("fileId") fileId: string) {
    return this.files.check(ctx, fileId);
  }

  /* ───────── orders ───────── */

  @Op("submitOrders", 201)
  submit(@ReqCtx() ctx: Ctx, @Body() b: Parameters<OrdersService["submit"]>[1]) {
    return this.orders.submit(ctx, b);
  }

  @Op("listOrders")
  list(@ReqCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    return this.orders.list(ctx, { ...q, mine: false });
  }

  @Op("listMyOrders")
  mine(@ReqCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    return this.orders.list(ctx, { ...q, mine: true });
  }

  @Op("getOrder")
  get(@ReqCtx() ctx: Ctx, @Param("orderId") id: string) {
    return this.orders.detail(ctx, id);
  }

  @Op("listOrderRecords")
  records(@ReqCtx() ctx: Ctx, @Param("orderId") id: string) {
    return this.orders.records(ctx, id);
  }

  @Op("addDeviceStopNote", 201)
  addNote(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { refRecordId: string; note: string; noteVisible?: boolean }) {
    return this.orders.addDeviceStopNote(ctx, id, b);
  }

  @Op("downloadVersionFile", 302)
  async download(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Param("n") n: string, @Res() res: Response) {
    res.redirect(302, await this.orders.versionFileUrl(ctx, id, Number(n)));
  }

  @Op("getOrderParts")
  parts(@ReqCtx() ctx: Ctx, @Param("orderId") id: string) {
    return this.orders.parts(ctx, id);
  }

  @Op("approveOrder")
  approve(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: OrderStatus; versionId: string; note?: string | null }) {
    return this.orders.approve(ctx, id, b);
  }

  @Op("rejectOrder")
  reject(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: OrderStatus; versionId: string; reason: string; reasonVisible?: boolean }) {
    return this.orders.reject(ctx, id, b);
  }

  @Op("reviseOrder", 201)
  revise(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: OrderStatus; fileId: string; plate: number }) {
    return this.orders.revise(ctx, id, b);
  }

  @Op("withdrawRevision")
  withdraw(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: OrderStatus; versionId: string }) {
    return this.orders.withdraw(ctx, id, b);
  }

  @Op("restoreVersion", 201)
  restore(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Param("n") n: string, @Body() b: { expectedStatus: OrderStatus }) {
    return this.orders.restore(ctx, id, Number(n), b);
  }

  @Op("cancelOrder")
  cancel(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: OrderStatus; reason: string; reasonVisible?: boolean }) {
    return this.orders.cancel(ctx, id, b);
  }

  @Op("reprintOrder")
  reprint(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { note?: string | null }) {
    return this.orders.reprint(ctx, id, b);
  }

  @Op("declineReprint")
  declineReprint(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { reason: string; reasonVisible?: boolean }) {
    return this.orders.declineReprint(ctx, id, b);
  }

  @Op("revokeReprintDecline")
  revokeDecline(@ReqCtx() ctx: Ctx, @Param("orderId") id: string) {
    return this.orders.revokeReprintDecline(ctx, id);
  }

  @Op("reconcileOrder")
  async reconcile(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: "DISPATCHED" | "PRINTING"; outcome: Judgement; note: string }) {
    await this.printers.judgeOrder(ctx, id, b);
    return this.orders.detail(ctx, id);
  }

  @Op("skipParts", 202)
  skipParts(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedJobId: string; partIds: number[] }) {
    return this.printers.skipParts(ctx, id, b);
  }

  /** Storing needs all three: where it was put, a photo of it, and the tick that the bed is clear. */
  @Op("storeOrder")
  @UseInterceptors(FileInterceptor("photo", { limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } }))
  store(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus?: string; slot?: string; bedCleared?: string }, @UploadedFile() photo: Upload) {
    const errors = [];
    if (b.expectedStatus !== "PRINTED") errors.push({ path: "/expectedStatus", code: "const" });
    if (!b.slot?.trim() || b.slot.length > 50) errors.push({ path: "/slot", code: "required" });
    if (b.bedCleared !== "true") errors.push({ path: "/bedCleared", code: "const" });
    if (!photo) errors.push({ path: "/photo", code: "required" });
    else if (!/^image\/(jpeg|png|webp)$/.test(photo.mimetype)) errors.push({ path: "/photo", code: "format" });
    if (errors.length) throw validationFailed(errors);
    return this.orders.store(ctx, id, { slot: b.slot!.trim(), photo: { data: photo!.buffer, contentType: photo!.mimetype } });
  }

  @Op("disposeOrder")
  dispose(@ReqCtx() ctx: Ctx, @Param("orderId") id: string, @Body() b: { expectedStatus: OrderStatus; reason: string; reasonVisible?: boolean }) {
    return this.orders.dispose(ctx, id, b);
  }

  /* ───────── pickup ───────── */

  @Op("issuePickupCode", 201)
  issueCode(@ReqCtx() ctx: Ctx, @Param("orderId") id: string) {
    return this.pickup.issue(ctx, id);
  }

  @Op("listRedemptions")
  redemptions(@ReqCtx() ctx: Ctx, @Query() q: Record<string, string>) {
    return this.pickup.redemptions(ctx, q);
  }

  @Op("lookupPickup")
  lookup(@ReqCtx() ctx: Ctx, @Param("code") code: string) {
    return this.pickup.lookup(ctx, code);
  }

  @Op("redeemPickup")
  redeem(@ReqCtx() ctx: Ctx, @Param("code") code: string) {
    return this.pickup.redeem(ctx, code);
  }

  /* ───────── queue and dispatch ───────── */

  @Op("getQueue")
  queue(@ReqCtx() ctx: Ctx) {
    return this.orders.queue(ctx);
  }

  @Op("reorderQueue")
  reorder(@ReqCtx() ctx: Ctx, @Body() b: { orderId: string; afterOrderId: string | null; expectedStatus: OrderStatus }) {
    return this.orders.reorder(ctx, b);
  }

  @Op("getDispatchSuggestions")
  suggestions() {
    return this.dispatcher.suggestions();
  }

  @Op("getDispatchOptions")
  options(@Param("printerId") printerId: string, @Query("orderId") orderId?: string) {
    return this.dispatcher.options(printerId, orderId);
  }

  @Op("dispatchOrder", 202)
  dispatch(@ReqCtx() ctx: Ctx, @Param("printerId") printerId: string, @Body() b: Parameters<DispatchService["dispatch"]>[2]) {
    return this.dispatcher.dispatch(ctx, printerId, b);
  }
}
