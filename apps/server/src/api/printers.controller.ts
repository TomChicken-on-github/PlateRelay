import { Body, Controller, Headers, Param, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { type Ctx, type PanelRequest, ReqCtx } from "../common/ctx.js";
import { Op } from "../common/op.js";
import { notFound } from "../common/problem.js";
import { SnapshotStore } from "../daemons/snapshot-store.js";
import type { PrinterState } from "../jobs/printer-state.js";
import { OverviewService } from "../overview/overview.service.js";
import { type Judgement, PrintersService } from "../printers/printers.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";

@Controller()
export class PrintersController {
  constructor(
    private readonly printers: PrintersService,
    private readonly overviewService: OverviewService,
    private readonly realtime: RealtimeService,
    private readonly snapshots: SnapshotStore,
  ) {}

  @Op("getOverview")
  overview(@ReqCtx() ctx: Ctx) {
    return this.overviewService.overview(ctx);
  }

  @Op("getResources")
  resources() {
    return this.overviewService.resources();
  }

  @Op("getTodo")
  todo(@ReqCtx() ctx: Ctx) {
    return this.overviewService.todo(ctx);
  }

  @Op("stream")
  stream(@ReqCtx() ctx: Ctx, @Req() req: PanelRequest, @Res() res: Response) {
    this.realtime.open(ctx, res, req.get("last-event-id"));
  }

  @Op("listPrinters")
  list(@ReqCtx() ctx: Ctx) {
    return this.printers.list(ctx);
  }

  @Op("createPrinter", 201)
  create(@ReqCtx() ctx: Ctx, @Body() b: Parameters<PrintersService["create"]>[1]) {
    return this.printers.create(ctx, b);
  }

  @Op("getPrinter")
  get(@ReqCtx() ctx: Ctx, @Param("printerId") id: string) {
    return this.printers.detail(ctx, id);
  }

  @Op("updatePrinter")
  update(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: Parameters<PrintersService["update"]>[2]) {
    return this.printers.update(ctx, id, b);
  }

  @Op("deletePrinter", 204)
  async remove(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { version: number }) {
    await this.printers.remove(ctx, id, b.version);
  }

  @Op("setPrinterOpen")
  setOpen(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { version: number; open: boolean }) {
    return this.printers.setOpen(ctx, id, b);
  }

  @Op("setTrayGrams")
  trayGrams(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Param("unit") unit: string, @Param("slot") slot: string, @Body() b: { grams: number }) {
    return this.printers.setTrayGrams(ctx, id, Number(unit), Number(slot), b.grams);
  }

  @Op("setPrinterStar")
  star(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { starred: boolean }) {
    return this.printers.setStar(ctx, id, b.starred);
  }

  @Op("enterMaintenance")
  enterMaintenance(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { expectedState: PrinterState; reason: string }) {
    return this.printers.enterMaintenance(ctx, id, b);
  }

  @Op("exitMaintenance")
  exitMaintenance(@ReqCtx() ctx: Ctx, @Param("printerId") id: string) {
    return this.printers.exitMaintenance(ctx, id);
  }

  @Op("stopPrint", 202)
  async stop(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { expectedState: PrinterState; expectedJobId?: string; reason: string; reasonVisible?: boolean }) {
    const out = await this.printers.stop(ctx, id, b);
    void this.realtime.commandSent(ctx, id, out.commandId, "job.stop");
    return out;
  }

  @Op("resolveError", 202)
  resolveError(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Param("errorId") errorId: string, @Body() b: { action: string }) {
    return this.printers.command(ctx, id, "error.resolve", { errorId, action: b.action });
  }

  @Op("controlPrinter", 202)
  async control(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { action: string; args: Record<string, unknown> }) {
    const out = await this.printers.command(ctx, id, "control", { action: b.action, args: b.args ?? {} });
    void this.realtime.commandSent(ctx, id, out.commandId, b.action);
    return out;
  }

  @Op("refreshPrinter", 202)
  refresh(@ReqCtx() ctx: Ctx, @Param("printerId") id: string) {
    return this.printers.command(ctx, id, "refresh", {});
  }

  @Op("releasePrinter")
  release(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { expectedJobId?: string | null; outcome?: Judgement | null; reason: string }) {
    return this.printers.release(ctx, id, b);
  }

  @Op("confirmBedCleared")
  clearBed(@ReqCtx() ctx: Ctx, @Param("printerId") id: string) {
    return this.printers.confirmBedCleared(ctx, id);
  }

  @Op("listPrinterEvents")
  events(@Param("printerId") id: string, @Query("cursor") cursor?: string) {
    return this.printers.events(id, cursor);
  }

  @Op("listPrinterErrors")
  errors(@Param("printerId") id: string, @Query() q: Record<string, string>) {
    return this.printers.errors(id, q);
  }

  @Op("listPrinterJobs")
  jobs(@Param("printerId") id: string, @Query() q: Record<string, string>) {
    return this.printers.jobs(id, q);
  }

  @Op("putPrinterPresence", 204)
  async presence(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Body() b: { streamId: string }) {
    await this.realtime.setPresence(ctx, id, b.streamId, true);
  }

  @Op("deletePrinterPresence", 204)
  async leave(@ReqCtx() ctx: Ctx, @Param("printerId") id: string, @Query("streamId") streamId: string) {
    await this.realtime.setPresence(ctx, id, streamId, false);
  }

  /** The latest still picture the daemon uploaded. Only the newest one is kept, in memory. */
  @Op("cameraSnapshot")
  snapshot(@Param("printerId") id: string, @Headers("if-none-match") etag: string | undefined, @Res() res: Response) {
    const shot = this.snapshots.get(id);
    if (!shot) throw notFound("snapshot");
    res.set({ ETag: shot.etag, "X-Captured-At": shot.capturedAt, "Cache-Control": "private, no-cache" });
    if (etag === shot.etag) return void res.status(304).end();
    res.type("image/jpeg").send(shot.data);
  }
}
