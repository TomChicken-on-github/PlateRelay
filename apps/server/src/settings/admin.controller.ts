import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { AUDIT_ACTOR_TYPES, AUDIT_RESULTS, ROLE_IDS, type AuditLogView } from "@platerelay/shared";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { auditViews } from "../audit/views.js";
import { type Ctx, ReqCtx, RequirePerm } from "../auth/actor.js";
import { parse } from "../common/zod.js";
import { DaemonsService } from "../daemons/daemons.service.js";
import { DB, type Db } from "../db/db.js";
import { FieldsSchema, FormsService } from "../forms/forms.service.js";
import { UsersService } from "../users/users.service.js";
import { SettingsService } from "./settings.service.js";

const Id = new ParseUUIDPipe();
const Daemon = z.object({ name: z.string().trim().min(1).max(40), network: z.string().trim().max(60).nullish() });
const AuditQuery = z.object({
  actorId: z.uuid().optional(),
  actorName: z.string().trim().min(1).max(80).optional(),
  actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
  action: z.string().trim().min(1).max(160).optional(),
  result: z.enum(AUDIT_RESULTS).optional(),
  targetType: z.string().max(40).optional(),
  targetId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).refine((q) => !q.from || !q.to || q.from <= q.to, { message: "开始时间不得晚于结束时间", path: ["to"] });

/** 系统设置: request form, users and roles, daemon tokens, policy, audit log. */
@Controller()
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly forms: FormsService,
    private readonly users: UsersService,
    private readonly daemons: DaemonsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  /* ---- request form: anyone signed in reads it, form:configure edits it ---- */

  @Get("form")
  async form() {
    const v = await this.forms.current();
    return { version: v.id, fields: v.fields };
  }

  @Put("form")
  @RequirePerm("form:configure")
  async setForm(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    const v = await this.forms.update(ctx, parse(z.object({ fields: FieldsSchema }), body).fields);
    return { version: v.id, fields: v.fields };
  }

  /* ---- users ---- */

  @Get("users")
  @RequirePerm("user:manage")
  async listUsers() {
    return (await this.users.list()).map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }));
  }

  @Get("roles")
  @RequirePerm("user:manage")
  roles() {
    return this.users.roles();
  }

  @Put("users/:id/role")
  @HttpCode(204)
  @RequirePerm("user:manage")
  async setRole(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    await this.users.setRole(ctx, id, parse(z.object({ role: z.enum(ROLE_IDS) }), body).role);
  }

  @Put("users/:id/disabled")
  @HttpCode(204)
  @RequirePerm("user:manage")
  async setDisabled(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    await this.users.setDisabled(ctx, id, parse(z.object({ disabled: z.boolean() }), body).disabled);
  }

  /* ---- daemon tokens ---- */

  @Get("daemons")
  @RequirePerm("daemon:manage")
  listDaemons() {
    return this.daemons.list();
  }

  /** The token is in this response only. */
  @Post("daemons")
  @RequirePerm("daemon:manage")
  createDaemon(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    const b = parse(Daemon, body);
    return this.daemons.create(ctx, b.name, b.network ?? null);
  }

  @Patch("daemons/:id")
  @RequirePerm("daemon:manage")
  setDaemon(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string, @Body() body: unknown) {
    return this.daemons.setEnabled(ctx, id, parse(z.object({ enabled: z.boolean() }), body).enabled);
  }

  @Delete("daemons/:id")
  @HttpCode(204)
  @RequirePerm("daemon:manage")
  async removeDaemon(@ReqCtx() ctx: Ctx, @Param("id", Id) id: string) {
    await this.daemons.remove(ctx, id);
  }

  /* ---- settings ---- */

  @Get("settings")
  @RequirePerm("settings:manage")
  async getSettings() {
    return { registration: await this.settings.get("auth.registration"), queue: await this.settings.get("queue.policy") };
  }

  @Put("settings/registration")
  @HttpCode(204)
  @RequirePerm("settings:manage")
  async setRegistration(@ReqCtx() ctx: Ctx, @Body() body: unknown) {
    await this.settings.set(ctx, "auth.registration", parse(z.object({ enabled: z.boolean() }), body));
  }

  /* ---- audit log ---- */

  /** Reading the audit log is itself audited (brief §0.7). */
  @Get("audit")
  @RequirePerm("audit:view")
  async auditLog(@ReqCtx() ctx: Ctx, @Query() q: unknown): Promise<AuditLogView[]> {
    const query = parse(AuditQuery, q);
    const rows = await this.audit.list(query);
    await this.audit.record(ctx, {
      action: "audit.view",
      after: {
        actorId: query.actorId,
        actorNameFiltered: query.actorName ? true : undefined,
        actorType: query.actorType,
        action: query.action,
        result: query.result,
        targetType: query.targetType,
        targetId: query.targetId,
        from: query.from?.toISOString(),
        to: query.to?.toISOString(),
        limit: query.limit,
        beforeId: query.beforeId,
      },
    });
    return auditViews(this.db, rows);
  }
}
