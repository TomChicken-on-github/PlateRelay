import { Inject, Injectable } from "@nestjs/common";
import { GUEST_PERMISSIONS, type Permission, type Role, ROLE_PERMISSIONS } from "@platerelay/shared";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import type { Ctx, GuestActor, UserActor } from "../common/ctx.js";
import { Problem } from "../common/problem.js";
import { DB, type Db, type Tx } from "../db/db.js";
import { sessions, users } from "../db/schema.js";
import { SettingsService } from "../settings/settings.service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { newToken, sha256 } from "./tokens.js";

export const SESSION_COOKIE = "pr_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/* Constant work when the user does not exist, so timing does not reveal accounts. */
const DUMMY_HASH = hashPassword("platerelay-dummy");

/** Failed sign-ins allowed per address and account name in a window before further tries are refused. */
const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type UserRow = typeof users.$inferSelect;

@Injectable()
export class AuthService {
  /*
   * Password guessing: failures counted per client address and account name, in memory (one panel
   * process). Keyed on both so a stranger elsewhere cannot lock someone out of their own account.
   */
  private readonly failures = new Map<string, { n: number; since: number }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async createUser(ctx: Ctx, input: { username: string; displayName: string; password: string; role: Role; email?: string | null }, tx: Tx = this.db): Promise<UserRow> {
    const passwordHash = await hashPassword(input.password);
    const [taken] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = lower(${input.username})`);
    if (taken) throw new Problem(422, "username_taken", "that username is in use");
    const [u] = await tx.insert(users).values({ username: input.username, displayName: input.displayName, passwordHash, role: input.role, email: input.email ?? null }).returning();
    await this.audit.record(ctx, { action: "user.create", targetType: "user", targetId: u.id, after: { role: input.role } }, tx);
    return u;
  }

  async hasUsers(tx: Tx = this.db): Promise<boolean> {
    const [u] = await tx.select({ id: users.id }).from(users).limit(1);
    return !!u;
  }

  /** Returns the raw session token for the cookie. */
  async login(ctx: Ctx, username: string, password: string): Promise<{ token: string; actor: UserActor }> {
    const key = `${ctx.ip ?? ""}\n${username.toLowerCase()}`;
    const now = Date.now();
    const f = this.failures.get(key);
    if (f && now - f.since < LOGIN_WINDOW_MS && f.n >= LOGIN_MAX_FAILURES) {
      await this.audit.record(ctx, { action: "auth.login", targetType: "user", result: "DENIED", reason: "throttled" });
      throw new Problem(429, "rate_limited", "too many failed sign-ins", { retryAfterSeconds: Math.ceil((f.since + LOGIN_WINDOW_MS - now) / 1000) });
    }
    const [u] = await this.db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`);
    const ok = u?.passwordHash ? await verifyPassword(password, u.passwordHash) : (await DUMMY_HASH, false);
    if (!ok || !u || u.disabledAt) {
      if (!f || now - f.since >= LOGIN_WINDOW_MS) this.failures.set(key, { n: 1, since: now });
      else f.n++;
      if (this.failures.size > 10_000) for (const [k, v] of this.failures) if (now - v.since >= LOGIN_WINDOW_MS) this.failures.delete(k);
      await this.audit.record(ctx, { action: "auth.login", targetType: "user", targetId: u?.id ?? null, result: "FAILED" });
      throw new Problem(401, "bad_credentials", "wrong username or password");
    }
    this.failures.delete(key);
    return { token: await this.openSession(ctx, u.id), actor: await this.toActor(u) };
  }

  async openSession(ctx: Ctx, userId: string, tx: Tx = this.db): Promise<string> {
    const token = newToken();
    await tx.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip: ctx.ip, userAgent: ctx.userAgent });
    await this.audit.record({ ...ctx, actor: { type: "USER", id: userId } as UserActor }, { action: "auth.login", targetType: "user", targetId: userId }, tx);
    return token;
  }

  async logout(ctx: Ctx, token: string) {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
    await this.audit.record(ctx, { action: "auth.logout", targetType: "user", targetId: ctx.actor.id });
  }

  /** Ends every session of a user: on disabling, so the account is out at once. */
  async endSessions(userId: string, tx: Tx = this.db) {
    await tx.delete(sessions).where(eq(sessions.userId, userId));
  }

  async actorForSession(token: string): Promise<UserActor | null> {
    const [u] = await this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()), isNull(users.disabledAt)));
    return u ? this.toActor(u.user) : null;
  }

  /** The role's permission nodes, minus the ones a setting switches off. */
  async toActor(u: Pick<UserRow, "id" | "username" | "displayName" | "role">): Promise<UserActor> {
    const permissions = new Set<Permission>(ROLE_PERMISSIONS[u.role]);
    if (u.role === "APPLICANT" && !(await this.settings.get("submit")).showWait) permissions.delete("queue:wait:view");
    return { type: "USER", id: u.id, username: u.username, displayName: u.displayName, role: u.role, permissions };
  }

  /** Someone not signed in: sees the overview while it is public, plus what the two guest switches allow. */
  async guest(): Promise<GuestActor> {
    const ui = await this.settings.get("ui");
    const permissions = new Set<Permission>();
    if (ui.overviewPublic) {
      for (const p of GUEST_PERMISSIONS) permissions.add(p);
      if (ui.guestFileName) permissions.add("overview:filename:view");
      if ((await this.settings.get("camera")).guestStream) permissions.add("printer:camera:stream");
    }
    return { type: "GUEST", id: null, permissions };
  }
}
