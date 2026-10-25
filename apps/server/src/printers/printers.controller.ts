import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { isIP } from "node:net";
import { z } from "zod";
import { type Ctx, ReqCtx, RequirePerm } from "../auth/actor.js";
import { ApiError } from "../common/errors.js";
import { parse } from "../common/zod.js";
import { PrintersService } from "./printers.service.js";

/* No access code here: it goes to the daemon, never to the panel (brief §5.1). */
const Printer = z.object({
  name: z.string().trim().min(1).max(40),
  ip: z.string().trim().refine((s) => isIP(s) !== 0, "IP 地址格式不对"),
  serial: z.string().trim().regex(/^[A-Za-z0-9]{6,32}$/, "序列号格式不对"),
  daemonId: z.uuid().nullish(),
});
const Maintenance = z.object({ on: z.boolean(), reason: z.string().trim().max(200).nullish() }).refine((b) => !b.on || !!b.reason, "下线维护要填原因");
const Resolve = z.object({ action: z.string().regex(/^[A-Z_]{2,40}$/), reason: z.string().trim().max(500).nullish() });
const Star = z.object({ starred: z.boolean() });

const Id = new ParseUUIDPipe();

@Controller()
export class PrintersController {
  constructor(private readonly printers: PrintersService) {}

  @Get("printers")
  @RequirePerm("overview:view")
  list(@ReqCtx() ctx: Ctx) {
    return this.printers.list(ctx);
  }

  @Get("printers/:id")
  @RequirePerm("overview:view")
  get(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string) {
    return this.printers.get(ctx, id);
  }

  @Post("printers")
  @RequirePerm("printer:manage")
  create(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    return this.printers.create(ctx, parse(Printer, body));
  }

  @Patch("printers/:id")
  @RequirePerm("printer:manage")
  update(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    return this.printers.update(ctx, id, parse(Printer.partial(), body));
  }

  @Delete("printers/:id")
  @HttpCode(204)
  @RequirePerm("printer:manage")
  async remove(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string) {
    await this.printers.remove(ctx, id);
  }

  @Post("printers/:id/maintenance")
  @HttpCode(200)
  @RequirePerm("printer:manage")
  maintenance(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    const b = parse(Maintenance, body);
    return this.printers.maintenance(ctx, id, b.on, b.reason ?? null);
  }

  @Post("printers/:id/star")
  @HttpCode(200)
  @RequirePerm("printer:manage")
  star(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    return this.printers.star(ctx, id, parse(Star, body).starred);
  }

  /** Error handling: STOP needs printer:stop and a reason; the rest need printer:operate. */
  @Post("printers/:id/resolve")
  @HttpCode(200)
  @RequirePerm("printer:operate", "printer:stop")
  resolve(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    const b = parse(Resolve, body);
    const need = b.action === "STOP" ? "printer:stop" : "printer:operate";
    if (ctx.actor.type !== "user" || !ctx.actor.permissions.has(need)) {
      throw new ApiError(HttpStatus.FORBIDDEN, "forbidden", "没有权限执行这个操作");
    }
    return this.printers.resolve(ctx, id, b.action, b.reason ?? null);
  }

  /** Stop a print (not only on error): the order fails with the reason. */
  @Post("printers/:id/stop")
  @HttpCode(200)
  @RequirePerm("printer:stop")
  stop(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    return this.printers.stop(ctx, id, parse(z.object({ reason: z.string().trim().min(1, "要选失败原因").max(500) }), body).reason);
  }

  @Post("printers/:id/clear-bed")
  @HttpCode(200)
  @RequirePerm("order:store")
  clearBed(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string) {
    return this.printers.clearBed(ctx, id);
  }

  @Get("todo")
  @RequirePerm("order:store", "printer:operate")
  todo(@ReqCtx() ctx: Ctx) {
    return this.printers.todo(ctx);
  }
}
