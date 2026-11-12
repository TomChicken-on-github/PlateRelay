import { Body, Controller, Inject, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthService, SESSION_COOKIE, SESSION_TTL_MS, type UserRow } from "../auth/auth.service.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { type Ctx, type PanelRequest, ReqCtx, userIdOf } from "../common/ctx.js";
import { Op } from "../common/op.js";
import { forbidden, notFound, Problem, stateConflict, versionConflict } from "../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DB, type Db } from "../db/db.js";
import { users } from "../db/schema.js";
import { SettingsService } from "../settings/settings.service.js";
import { and, eq, sql } from "drizzle-orm";

export function userView(u: UserRow) {
  return { id: u.id, username: u.username, displayName: u.displayName, email: u.email, phone: u.phone, role: u.role, avatarUrl: null, disabled: !!u.disabledAt, createdAt: u.createdAt.toISOString(), version: u.version };
}

@Controller()
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  private async me(userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw notFound("user");
    return { user: userView(u), locale: u.locale, permissions: [...(await this.auth.toActor(u)).permissions].sort() };
  }

  private setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: this.config.secureCookies, path: "/", maxAge: SESSION_TTL_MS });
  }

  @Op("getAuthMethods")
  async methods() {
    const open = (await this.settings.get("accounts")).openRegistration;
    return { register: open ? ["OPEN"] : [], oidc: [], emailDomains: [], setupRequired: !(await this.auth.hasUsers()) };
  }

  /** First start only: creates the first administrator. Refused as soon as any account exists. */
  @Op("setup", 201)
  async setup(@ReqCtx() ctx: Ctx, @Body() b: { username: string; password: string; displayName: string; orgName: string; timezone: string }, @Res({ passthrough: true }) res: Response) {
    const { user, token } = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7003)`);
      if (await this.auth.hasUsers(tx)) throw stateConflict("SET_UP");
      const user = await this.auth.createUser(ctx, { username: b.username, displayName: b.displayName, password: b.password, role: "ADMIN" }, tx);
      const actor = { ...ctx, actor: await this.auth.toActor(user) };
      await this.settings.save(actor, "general", (await this.settings.row("general", tx)).version, { orgName: b.orgName, timezone: b.timezone }, tx);
      return { user, token: await this.auth.openSession(ctx, user.id, tx) };
    });
    this.setCookie(res, token);
    return this.me(user.id);
  }

  @Op("login")
  async login(@ReqCtx() ctx: Ctx, @Body() b: { username: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const { token, actor } = await this.auth.login(ctx, b.username, b.password);
    this.setCookie(res, token);
    return this.me(actor.id);
  }

  @Op("logout", 204)
  async logout(@ReqCtx() ctx: Ctx, @Req() req: PanelRequest, @Res({ passthrough: true }) res: Response) {
    if (req.sessionToken) await this.auth.logout(ctx, req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  /** Self-registration, only while an administrator has opened it; new accounts are applicants. */
  @Op("register", 201)
  async register(@ReqCtx() ctx: Ctx, @Body() b: { method: string; username: string; password?: string; displayName: string; email?: string }, @Res({ passthrough: true }) res: Response) {
    if (b.method !== "OPEN" || !(await this.settings.get("accounts")).openRegistration) throw forbidden("this way of registering is not open");
    if (!b.password || b.password.length < 8) throw new Problem(422, "validation_failed", "password too short", undefined, [{ path: "/password", code: "minLength", params: { limit: 8 } }]);
    const user = await this.auth.createUser(ctx, { username: b.username, displayName: b.displayName, password: b.password, role: "APPLICANT", email: b.email });
    this.setCookie(res, await this.auth.openSession(ctx, user.id));
    return this.me(user.id);
  }

  @Op("getMe")
  getMe(@ReqCtx() ctx: Ctx) {
    return this.me(userIdOf(ctx)!);
  }

  @Op("updateMe")
  async updateMe(@ReqCtx() ctx: Ctx, @Body() b: { version: number; displayName?: string; locale?: string }) {
    const id = userIdOf(ctx)!;
    const changed = await this.db
      .update(users)
      .set({ ...(b.displayName !== undefined ? { displayName: b.displayName } : {}), ...(b.locale !== undefined ? { locale: b.locale } : {}), version: b.version + 1 })
      .where(and(eq(users.id, id), eq(users.version, b.version)))
      .returning({ id: users.id });
    if (!changed.length) throw versionConflict((await this.me(id)).user.version);
    return this.me(id);
  }

  @Op("changePassword", 204)
  async changePassword(@ReqCtx() ctx: Ctx, @Body() b: { current: string; next: string }) {
    const id = userIdOf(ctx)!;
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u?.passwordHash || !(await verifyPassword(b.current, u.passwordHash))) throw new Problem(422, "bad_credentials", "the current password is wrong");
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(b.next) })
      .where(eq(users.id, id));
  }
}
