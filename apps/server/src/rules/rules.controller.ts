import { Body, Controller, Get, HttpCode, Put } from "@nestjs/common";
import { REVISION_PENALTIES, type ResourceSettings, type ResourcesView, WAIT_BUCKETS, type QueueRules } from "@platerelay/shared";
import { z } from "zod";
import { type Ctx, ReqCtx, RequirePerm } from "../auth/actor.js";
import { parse } from "../common/zod.js";
import { SettingsService } from "../settings/settings.service.js";
import { ResourcesService } from "./resources.service.js";

const count = (max: number) => z.number().int().min(0).max(max);

const Rules = z.object({
  revisions: z.object({
    enabled: z.boolean(),
    max: count(99),
    autoApproveMinor: z.boolean(),
    thresholdMinutes: count(24 * 60),
    penalty: z.enum(REVISION_PENALTIES),
    places: count(999),
    stepMinutes: z.number().int().min(1).max(24 * 60),
    baseline: z.enum(["original", "previous"]),
    whenDispatched: z.enum(["recall", "refuse"]),
    dispatchedExtraPlaces: count(999),
  }),
  modelSwitch: z.object({
    max: count(99),
    position: z.enum(["original", "tail"]),
    extraPlaces: count(999),
    countsAsRevision: z.boolean(),
    dualToSingleCounts: z.boolean(),
  }),
  skipReminderMinutes: z.number().int().min(1).max(24 * 60),
  allowPlateChoice: z.boolean(),
}) satisfies z.ZodType<QueueRules>;

const Note = z.string().trim().max(40);
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不对").transform((s) => s.toLowerCase());
const Resources = z.object({
  show: z.boolean(),
  showWait: z.boolean(),
  colourMissing: z.enum(["warn", "block"]),
  bulletin: z.string().trim().max(200),
  models: z.record(z.string().min(1).max(20), z.object({ hidden: z.boolean().optional(), note: Note.optional(), wait: z.enum(WAIT_BUCKETS).nullish(), order: count(9999).optional() })),
  materials: z.record(z.string().min(1).max(40), z.object({ hidden: z.boolean().optional(), note: Note.optional(), order: count(9999).optional() })),
  stock: z
    .array(z.object({ id: z.string().min(1).max(40), type: z.string().trim().min(1).max(40), color: Hex, name: z.string().trim().min(1).max(20), modelIds: z.array(z.string().min(1).max(20)).min(1, "至少选一个机型").max(20) }))
    .max(200),
}) satisfies z.ZodType<ResourceSettings, unknown>;

/** 文件与排队 and 可用资源 (rules doc §1.5, §2–4). */
@Controller()
export class RulesController {
  constructor(
    private readonly settings: SettingsService,
    private readonly resources: ResourcesService,
  ) {}

  /** The rules are public to everyone signed in: the submit page and 我的订单 follow them. */
  @Get("rules")
  rules() {
    return this.settings.get("queue.rules");
  }

  @Put("settings/rules")
  @HttpCode(204)
  @RequirePerm("settings:manage")
  async setRules(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    await this.settings.set(ctx, "queue.rules", parse(Rules, body));
  }

  /** 本场可用资源 as the viewer may see it. */
  @Get("resources")
  @RequirePerm("resource:view")
  view(@ReqCtx() ctx: Ctx): Promise<ResourcesView> {
    return this.resources.view(ctx);
  }

  @Get("settings/resources")
  @RequirePerm("resource:configure")
  getResources() {
    return this.settings.get("resources");
  }

  @Put("settings/resources")
  @HttpCode(204)
  @RequirePerm("resource:configure")
  async setResources(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    await this.settings.set(ctx, "resources", parse(Resources, body));
  }
}
