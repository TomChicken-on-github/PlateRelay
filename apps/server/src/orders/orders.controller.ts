import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, UploadedFile, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { FAILURE_ATTRIBUTIONS, MAX_UPLOAD_BYTES, ORDER_STATUSES } from "@platerelay/shared";
import { z } from "zod";
import { type Ctx, ReqCtx, RequirePerm } from "../auth/actor.js";
import { parse } from "../common/zod.js";
import { OrdersService } from "./orders.service.js";
import { PickupService } from "./pickup.service.js";

const Reason = z.object({ reason: z.string().trim().min(1, "要填写原因").max(500) });
const Attribute = z.object({ attribution: z.enum(FAILURE_ATTRIBUTIONS), note: z.string().trim().max(500).nullish() });
const SkipParts = z.object({ parts: z.array(z.number().int().positive()).min(1, "至少选一个零件").max(256) });
const Reorder =z.object({ orderId: z.number().int().positive(), toPosition: z.number().int().positive(), reason: z.string().trim().max(500).nullish() });
const Store = z.object({ slot: z.string().trim().min(1).max(40), bedCleared: z.literal("true", { message: "要确认热床已清理" }) });
const ListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",") : undefined))
    .pipe(z.array(z.enum(ORDER_STATUSES)).optional()),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** 1-based plate numbers, as a JSON array in the multipart body. */
const Plates = z.array(z.number().int().positive()).max(64);

const PHOTO_MAX = 15 * 1024 * 1024;

function json(text: string, field: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestException(`${field} 不是合法的 JSON`);
  }
}

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly pickup: PickupService,
  ) {}

  /** Submit: multipart with "file" (.gcode.3mf) and "answers" (JSON of the request form). */
  @Post("orders")
  @RequirePerm("order:submit")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, defParamCharset: "utf8" }))
  async submit(@ReqCtx() ctx: Ctx, @UploadedFile() file: Express.Multer.File | undefined, @Body("answers") answers: string | undefined, @Body("plates") plates: string | undefined) {
    if (!file) throw new BadRequestException("缺少文件字段 file");
    const picked = plates ? parse(Plates, json(plates, "plates")) : undefined;
    return { orders: await this.orders.submit(ctx, file.originalname, file.buffer, answers ? json(answers, "answers") : {}, picked) };
  }

  /** The submit page's preview: parse result, per-plate availability and the queue. Nothing is stored. */
  @Post("orders/preview")
  @HttpCode(200)
  @RequirePerm("order:submit")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, defParamCharset: "utf8" }))
  preview(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException("缺少文件字段 file");
    return this.orders.preview(file.originalname, file.buffer);
  }

  @Get("overview")
  @RequirePerm("overview:view")
  overview() {
    return this.orders.overview();
  }

  @Get("orders/mine")
  mine(@ReqCtx() ctx: Ctx) {
    return this.orders.mine(ctx);
  }

  @Get("orders")
  @RequirePerm("order:view:any")
  list(@ReqCtx() ctx: Ctx, @Query() q: unknown) {
    return this.orders.list(ctx, parse(ListQuery, q));
  }

  @Get("orders/:id")
  detail(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number) {
    return this.orders.detail(ctx, id);
  }

  @Get("orders/:id/file")
  async file(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number) {
    return { url: await this.orders.fileUrl(ctx, id) };
  }

  @Get("review")
  @RequirePerm("order:review")
  review(@ReqCtx() ctx: Ctx) {
    return this.orders.reviewPool(ctx);
  }

  @Post("orders/:id/approve")
  @HttpCode(200)
  @RequirePerm("order:review")
  approve(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number) {
    return this.orders.approve(ctx, id);
  }

  @Post("orders/:id/reject")
  @HttpCode(200)
  @RequirePerm("order:review")
  reject(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.orders.reject(ctx, id, parse(Reason, body).reason);
  }

  /** Own orders before printing (order:cancel:own) or anything unfinished (order:cancel:any); checked in the service. */
  @Post("orders/:id/cancel")
  @HttpCode(200)
  @RequirePerm("order:cancel:own", "order:cancel:any")
  cancel(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.orders.cancel(ctx, id, parse(Reason, body).reason);
  }

  @Get("orders/:id/parts")
  parts(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number) {
    return this.orders.parts(ctx, id);
  }

  /** 跳过零件 on a running print: own orders (order:skip-parts:own) or any (order:skip-parts:any); checked in the service. */
  @Post("orders/:id/skip-parts")
  @HttpCode(200)
  @RequirePerm("order:skip-parts:own", "order:skip-parts:any")
  skipParts(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.orders.skipParts(ctx, id, parse(SkipParts, body).parts);
  }

  @Post("orders/:id/attribute")
  @HttpCode(200)
  @RequirePerm("order:attribute")
  attribute(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const b = parse(Attribute, body);
    return this.orders.attribute(ctx, id, b.attribution, b.note ?? null);
  }

  @Post("queue/reorder")
  @HttpCode(204)
  @RequirePerm("order:reorder")
  async reorder(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(Reorder, body);
    await this.orders.reorder(ctx, b.orderId, b.toPosition, b.reason ?? null);
  }

  /** 铲件入库: multipart with "photo", "slot" and "bedCleared"=true. */
  @Post("orders/:id/store")
  @HttpCode(200)
  @RequirePerm("order:store")
  @UseInterceptors(FileFieldsInterceptor([{ name: "photo", maxCount: 1 }], { limits: { fileSize: PHOTO_MAX, files: 1 } }))
  store(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number, @UploadedFiles() up: { photo?: Express.Multer.File[] }, @Body() body: unknown) {
    const b = parse(Store, body);
    const photo = up?.photo?.[0];
    if (!photo) throw new BadRequestException("缺少入库照片 photo");
    return this.orders.store(ctx, id, b.slot, photo.buffer);
  }

  /* ---- pickup ---- */

  /** 出示取件码: owner only; valid ten minutes, a new one revokes the old one. */
  @Post("orders/:id/pickup-code")
  @HttpCode(200)
  issue(@ReqCtx() ctx: Ctx, @Param("id", ParseIntPipe) id: number) {
    return this.pickup.issue(ctx, id);
  }

  @Get("pickup/redemptions")
  @RequirePerm("order:redeem")
  redemptions(@Query("since") since: string | undefined) {
    const d = since ? new Date(since) : new Date(new Date().setHours(0, 0, 0, 0));
    if (Number.isNaN(d.getTime())) throw new BadRequestException("since 不是合法的时间");
    return this.pickup.redemptions(d);
  }

  @Get("pickup/:code")
  @RequirePerm("order:redeem")
  lookup(@ReqCtx() ctx: Ctx, @Param("code") code: string) {
    return this.pickup.lookup(ctx, code);
  }

  @Post("pickup/:code/redeem")
  @HttpCode(200)
  @RequirePerm("order:redeem")
  redeem(@ReqCtx() ctx: Ctx, @Param("code") code: string) {
    return this.pickup.redeem(ctx, code);
  }
}
