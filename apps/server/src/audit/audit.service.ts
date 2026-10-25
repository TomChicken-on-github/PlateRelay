import { Inject, Injectable } from "@nestjs/common";
import type { AuditActorType, AuditResult } from "@platerelay/shared";
import { and, desc, eq, gte, ilike, inArray, lt, lte, type SQL } from "drizzle-orm";
import type { Ctx } from "../auth/actor.js";
import { DB, type Db } from "../db/db.js";
import { auditLog, users } from "../db/schema.js";

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: "ok" | "failed" | "denied";
}

export interface AuditQuery {
  actorId?: string;
  actorName?: string;
  actorType?: AuditActorType;
  action?: string;
  result?: AuditResult;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit: number;
  beforeId?: number;
}

/**
 * Append-only "who did what" log (brief §0.7). Write it inside the same
 * transaction as the change it describes. Never pass secrets.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(ctx: Ctx, e: AuditEntry, tx: Db = this.db): Promise<void> {
    await tx.insert(auditLog).values({
      actorType: ctx.actor.type,
      actorId: ctx.actor.id ?? null,
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId == null ? null : String(e.targetId),
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
      result: e.result ?? "ok",
      ip: ctx.ip,
      device: ctx.device,
    });
  }

  list(q: AuditQuery) {
    const where: SQL[] = [];
    if (q.actorId) where.push(eq(auditLog.actorId, q.actorId));
    if (q.actorType) where.push(eq(auditLog.actorType, q.actorType));
    if (q.actorName) {
      const like = `%${q.actorName.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(eq(auditLog.actorType, "user"), inArray(auditLog.actorId, this.db.select({ id: users.id }).from(users).where(ilike(users.displayName, like))));
    }
    if (q.action) where.push(eq(auditLog.action, q.action));
    if (q.result) where.push(eq(auditLog.result, q.result));
    if (q.targetType) where.push(eq(auditLog.targetType, q.targetType));
    if (q.targetId) where.push(eq(auditLog.targetId, q.targetId));
    if (q.from) where.push(gte(auditLog.at, q.from));
    if (q.to) where.push(lte(auditLog.at, q.to));
    if (q.beforeId !== undefined) where.push(lt(auditLog.id, q.beforeId));
    return this.db
      .select()
      .from(auditLog)
      .where(and(...where))
      .orderBy(desc(auditLog.id))
      .limit(q.limit);
  }
}
