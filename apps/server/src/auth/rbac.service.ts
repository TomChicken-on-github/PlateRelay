import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { isPermission, type Permission, PRESET_ROLES } from "@platerelay/shared";
import { eq, sql } from "drizzle-orm";
import { DB, type Db } from "../db/db.js";
import { roles, userRoles, users } from "../db/schema.js";
import type { UserActor } from "./actor.js";

/** Roles live in the database; the preset ones are rewritten from PRESET_ROLES on every start. */
@Injectable()
export class RbacService implements OnApplicationBootstrap {
  private readonly log = new Logger("Rbac");

  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationBootstrap() {
    await this.syncPresetRoles();
  }

  async syncPresetRoles() {
    for (const [id, r] of Object.entries(PRESET_ROLES)) {
      await this.db
        .insert(roles)
        .values({ id, name: r.name, builtin: true, permissions: [...r.permissions] })
        .onConflictDoUpdate({ target: roles.id, set: { name: r.name, permissions: [...r.permissions] }, where: sql`${roles.builtin}` });
    }
  }

  /** The actor for a user id, or null when the account is gone or disabled. */
  async actorFor(id: string, db: Db = this.db): Promise<UserActor | null> {
    const [row] = await db
      .select({ id: users.id, username: users.username, displayName: users.displayName, disabled: users.disabled, roleId: roles.id, roleName: roles.name, permissions: roles.permissions })
      .from(users)
      .leftJoin(userRoles, sql`${userRoles.userId} = ${users.id} and ${userRoles.scope} = 'global'`)
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(users.id, id));
    if (!row || row.disabled) return null;
    const perms = new Set<Permission>();
    for (const p of row.permissions ?? []) {
      if (isPermission(p)) perms.add(p);
      else this.log.warn(`role ${row.roleId} has unknown permission ${p}`);
    }
    return {
      type: "user",
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      roleId: row.roleId ?? "",
      roleName: row.roleName ?? "",
      permissions: perms,
    };
  }
}
