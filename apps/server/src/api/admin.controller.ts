import { Body, Controller, Inject, Param, Query } from "@nestjs/common";
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import { can, type Ctx, ReqCtx, userIdOf } from "../common/ctx.js";
import { Op } from "../common/op.js";
import { forbidden, notFound, ruleViolation, versionConflict } from "../common/problem.js";
import { DaemonsService } from "../daemons/daemons.service.js";
import { DB, type Db } from "../db/db.js";
import { auditLog, users } from "../db/schema.js";
import { type FormField, OrdersService } from "../orders/orders.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { SettingsService, type SectionRow } from "../settings/settings.service.js";
import { userView } from "./auth.controller.js";

/* Sections a resource manager may change without being an administrator: what is open and how the queue treats submissions. */
const RESOURCE_SECTIONS = new Set(["submit", "queue", "mapping"]);

@Controller()
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly daemons: DaemonsService,
    private readonly orders: OrdersService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ───────── users ───────── */

  @Op("listUsers")
  async listUsers(@Query() q: { limit?: string; cursor?: string; q?: string; role?: "APPLICANT" | "STAFF" | "ADMIN"; disabled?: string }) {
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const like = q.q ? `%${q.q.replace(/[%_\\]/g, "\\$&")}%` : null;
    const rows = await this.db
      .select()
      .from(users)
      .where(and(q.cursor ? lt(users.id, q.cursor) : undefined, like ? or(ilike(users.username, like), ilike(users.displayName, like)) : undefined, q.role ? eq(users.role, q.role) : undefined, q.disabled === "true" ? isNotNull(users.disabledAt) : q.disabled === "false" ? isNull(users.disabledAt) : undefined))
      .orderBy(desc(users.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { items: page.map(userView), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
  }

  /** Changing a role or disabling an account takes effect at once: sessions of a disabled user end, open streams are cut so they reconnect with the new permissions. */
  @Op("updateUser")
  async updateUser(@ReqCtx() ctx: Ctx, @Param("userId") id: string, @Body() b: { version: number; role?: "APPLICANT" | "STAFF" | "ADMIN"; disabled?: boolean; reason?: string | null }) {
    const out = await this.db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, id)).for("update");
      if (!u) throw notFound("user");
      if (u.version !== b.version) throw versionConflict(u.version);
      const role = b.role ?? u.role;
      const disabled = b.disabled ?? !!u.disabledAt;
      if (u.id === userIdOf(ctx) && (role !== u.role || disabled)) throw ruleViolation("you cannot change your own role or disable yourself", { rule: "own_account" });
      if (u.role === "ADMIN" && !u.disabledAt && (role !== "ADMIN" || disabled)) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.role, "ADMIN"), isNull(users.disabledAt)));
        if (n <= 1) throw ruleViolation("this is the last administrator", { rule: "last_admin" });
      }
      const [next] = await tx
        .update(users)
        .set({ role, disabledAt: disabled ? (u.disabledAt ?? new Date()) : null, version: u.version + 1 })
        .where(eq(users.id, u.id))
        .returning();
      if (disabled) await this.auth.endSessions(u.id, tx);
      await this.audit.record(ctx, { action: "user.update", targetType: "user", targetId: u.id, before: { role: u.role, disabled: !!u.disabledAt }, after: { role, disabled }, reason: b.reason ?? null }, tx);
      return next;
    });
    this.realtime.dropUser(id);
    return userView(out);
  }

  /* ───────── daemons ───────── */

  @Op("listDaemons")
  listDaemons() {
    return this.daemons.list();
  }

  @Op("createEnrollment", 201)
  createEnrollment(@ReqCtx() ctx: Ctx, @Body() b: { name: string }) {
    return this.daemons.createEnrollment(ctx, b.name);
  }

  @Op("updateDaemon")
  updateDaemon(@ReqCtx() ctx: Ctx, @Param("daemonId") id: string, @Body() b: { version: number; name: string }) {
    return this.daemons.rename(ctx, id, b);
  }

  @Op("revokeDaemon")
  revokeDaemon(@ReqCtx() ctx: Ctx, @Param("daemonId") id: string, @Body() b: { version: number; reason: string }) {
    return this.daemons.revoke(ctx, id, b);
  }

  /** The key a browser encrypts a printer's access code with, so that only the daemon can read it. */
  @Op("getDaemonPublicKey")
  daemonKey(@Param("daemonId") id: string) {
    return this.daemons.publicKey(id);
  }

  /* ───────── form and settings ───────── */

  @Op("getForm")
  form() {
    return this.orders.form();
  }

  @Op("saveForm")
  saveForm(@ReqCtx() ctx: Ctx, @Body() b: { basedOnVersionId: string; fields: FormField[] }) {
    return this.orders.saveForm(ctx, b.basedOnVersionId, b.fields);
  }

  @Op("getPublicSettings")
  async publicSettings() {
    const [general, ui, camera] = await Promise.all([this.settings.get("general"), this.settings.get("ui"), this.settings.get("camera")]);
    return { orgName: general.orgName, timezone: general.timezone, defaultLocale: general.defaultLocale, overviewPublic: ui.overviewPublic, guestStream: camera.guestStream };
  }

  private async sectionView(r: SectionRow) {
    const [by] = r.updatedBy ? await this.db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, r.updatedBy)) : [];
    return { section: r.section, values: r.values, defaults: r.defaults, version: r.version, updatedAt: r.updatedAt?.toISOString() ?? null, updatedBy: by ? { id: by.id, name: by.displayName, avatarUrl: null } : null };
  }

  @Op("getSettings")
  async getSettings(@ReqCtx() ctx: Ctx) {
    const rows = (await this.settings.all()).filter((r) => can(ctx, "settings:manage") || RESOURCE_SECTIONS.has(r.section));
    return Promise.all(rows.map((r) => this.sectionView(r)));
  }

  @Op("saveSettingsSection")
  async saveSettings(@ReqCtx() ctx: Ctx, @Param("section") section: string, @Body() b: { version: number; values: Record<string, unknown> }) {
    if (!can(ctx, "settings:manage") && !RESOURCE_SECTIONS.has(section)) throw forbidden();
    return this.sectionView(await this.settings.save(ctx, section, b.version, b.values));
  }

  /* ───────── audit ───────── */

  @Op("listAudit")
  async listAudit(@Query() q: { limit?: string; cursor?: string; action?: string; actorId?: string; targetType?: string; targetId?: string; from?: string; to?: string }) {
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    const rows = await this.db
      .select({ a: auditLog, name: users.displayName })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(
        and(
          q.cursor ? lt(auditLog.id, Number(q.cursor)) : undefined,
          q.action ? eq(auditLog.action, q.action) : undefined,
          q.actorId ? eq(auditLog.actorId, q.actorId) : undefined,
          q.targetType ? eq(auditLog.targetType, q.targetType) : undefined,
          q.targetId ? eq(auditLog.targetId, q.targetId) : undefined,
          q.from ? gte(auditLog.at, new Date(q.from)) : undefined,
          q.to ? lte(auditLog.at, new Date(q.to)) : undefined,
        ),
      )
      .orderBy(desc(auditLog.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map(({ a, name }) => ({
        id: a.id,
        at: a.at.toISOString(),
        actorType: a.actorType,
        actor: a.actorType === "USER" && a.actorId ? { id: a.actorId, name: name ?? "", avatarUrl: null } : null,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        before: a.before,
        after: a.after,
        reason: a.reason,
        result: a.result,
        requestId: a.requestId,
        ip: a.ip,
      })),
      nextCursor: rows.length > limit ? String(page[page.length - 1].a.id) : null,
    };
  }
}
