import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ROLE_IDS, type RoleId } from "@platerelay/shared";
import { asc, eq, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userId } from "../auth/actor.js";
import { ApiError, notFound } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { roles, sessions, userRoles, users } from "../db/schema.js";

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.db
      .select({ id: users.id, username: users.username, displayName: users.displayName, disabled: users.disabled, createdAt: users.createdAt, roleId: roles.id, roleName: roles.name })
      .from(users)
      .leftJoin(userRoles, sql`${userRoles.userId} = ${users.id} and ${userRoles.scope} = 'global'`)
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .orderBy(asc(users.createdAt));
  }

  roles() {
    return this.db.select().from(roles).orderBy(asc(roles.id));
  }

  async setRole(ctx: Ctx, id: string, role: RoleId) {
    if (!ROLE_IDS.includes(role)) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid", "角色不存在");
    if (id === userId(ctx)) throw new ApiError(HttpStatus.CONFLICT, "self-role", "不能修改自己的角色");
    await this.db.transaction(async (tx) => {
      const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, id));
      if (!u) throw notFound("用户");
      const [cur] = await tx.select({ roleId: userRoles.roleId }).from(userRoles).where(sql`${userRoles.userId} = ${id} and ${userRoles.scope} = 'global'`);
      await tx
        .insert(userRoles)
        .values({ userId: id, scope: "global", roleId: role })
        .onConflictDoUpdate({ target: [userRoles.userId, userRoles.scope], set: { roleId: role } });
      await this.audit.record(ctx, { action: "user.role", targetType: "user", targetId: id, before: { role: cur?.roleId ?? null }, after: { role } }, tx);
    });
  }

  /** Disabling also signs the account out everywhere. */
  async setDisabled(ctx: Ctx, id: string, disabled: boolean) {
    if (id === userId(ctx)) throw new ApiError(HttpStatus.CONFLICT, "self-disable", "不能停用自己的账户");
    await this.db.transaction(async (tx) => {
      const [u] = await tx.update(users).set({ disabled }).where(eq(users.id, id)).returning({ id: users.id });
      if (!u) throw notFound("用户");
      if (disabled) await tx.delete(sessions).where(eq(sessions.userId, id));
      await this.audit.record(ctx, { action: disabled ? "user.disable" : "user.enable", targetType: "user", targetId: id }, tx);
    });
  }
}
