import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { RoleId } from "@platerelay/shared";
import { and, eq, gt, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { sessions, userRoles, users } from "../db/schema.js";
import type { Ctx, UserActor } from "./actor.js";
import { hashPassword, verifyPassword } from "./password.js";
import { RbacService } from "./rbac.service.js";
import { newToken, sha256 } from "./tokens.js";

export const SESSION_COOKIE = "plr_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/* Constant work when the user does not exist, so timing does not reveal accounts. */
const DUMMY_HASH = hashPassword("platerelay-dummy");

/** Failed sign-ins allowed per address and account name in a window, before further tries are refused. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a local account. Used by self sign-up and by the create-user script. */
  async createUser(ctx: Ctx, input: { username: string; displayName: string; password: string; role: RoleId }, db: Db = this.db) {
    const passwordHash = await hashPassword(input.password);
    return db.transaction(async (tx) => {
      const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${input.username})`);
      if (taken) throw new ApiError(HttpStatus.CONFLICT, "username-taken", "用户名已被占用");
      const [u] = await tx.insert(users).values({ username: input.username, displayName: input.displayName, passwordHash }).returning({ id: users.id });
      await tx.insert(userRoles).values({ userId: u.id, roleId: input.role });
      await this.audit.record(ctx, { action: "user.create", targetType: "user", targetId: u.id, after: { role: input.role } }, tx);
      return u.id;
    });
  }

  /*
   * Password guessing: failures counted per client address and account name, in memory (one panel
   * process). Keyed on both so a stranger elsewhere cannot lock someone out of their own account.
   */
  private readonly failures = new Map<string, { n: number; since: number }>();

  /** Returns the raw session token for the cookie. */
  async login(ctx: Ctx, username: string, password: string): Promise<{ token: string; actor: UserActor }> {
    const key = `${ctx.ip ?? ""}\n${username.toLowerCase()}`;
    const now = Date.now();
    const f = this.failures.get(key);
    if (f && now - f.since < LOGIN_WINDOW_MS && f.n >= LOGIN_MAX_FAILURES) {
      await this.audit.record(ctx, { action: "auth.login", targetType: "user", targetId: null, result: "denied", reason: "throttled" });
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, "login-throttled", "尝试次数太多，请 15 分钟后再试", { retryAfterSeconds: Math.ceil((f.since + LOGIN_WINDOW_MS - now) / 1000) });
    }
    const [u] = await this.db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
    const ok = u?.passwordHash ? await verifyPassword(password, u.passwordHash) : (await DUMMY_HASH, false);
    const actor = ok && u ? await this.rbac.actorFor(u.id) : null;
    if (!actor) {
      if (!f || now - f.since >= LOGIN_WINDOW_MS) this.failures.set(key, { n: 1, since: now });
      else f.n++;
      if (this.failures.size > 10_000) for (const [k, v] of this.failures) if (now - v.since >= LOGIN_WINDOW_MS) this.failures.delete(k);
      await this.audit.record(ctx, { action: "auth.login", targetType: "user", targetId: u?.id ?? null, result: "failed" });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "bad-credentials", "用户名或密码错误");
    }
    this.failures.delete(key);
    const token = newToken();
    await this.db.transaction(async (tx) => {
      await tx.insert(sessions).values({
        tokenHash: sha256(token),
        userId: actor.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ip: ctx.ip,
        userAgent: ctx.device,
      });
      await this.audit.record({ ...ctx, actor }, { action: "auth.login", targetType: "user", targetId: actor.id }, tx);
    });
    return { token, actor };
  }

  async logout(ctx: Ctx, token: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
      await this.audit.record(ctx, { action: "auth.logout", targetType: "user", targetId: ctx.actor.id ?? null }, tx);
    });
  }

  async actorForSession(token: string): Promise<UserActor | null> {
    const [s] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
    return s ? this.rbac.actorFor(s.userId) : null;
  }
}
