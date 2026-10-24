import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { Ctx } from "../auth/actor.js";
import { DB, type Db } from "../db/db.js";
import { auditLog } from "../db/schema.js";

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
    if (q.targetType) where.push(eq(auditLog.targetType, q.targetType));
    if (q.targetId) where.push(eq(auditLog.targetId, q.targetId));
    if (q.from) where.push(gte(auditLog.at, q.from));
    if (q.to) where.push(lte(auditLog.at, q.to));
    if (q.beforeId) where.push(lte(auditLog.id, q.beforeId - 1));
    return this.db
      .select()
      .from(auditLog)
      .where(and(...where))
      .orderBy(desc(auditLog.id))
      .limit(q.limit);
  }
}
