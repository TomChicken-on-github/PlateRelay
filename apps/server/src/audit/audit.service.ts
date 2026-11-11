import { Inject, Injectable } from "@nestjs/common";
import { actorColumns, type Ctx } from "../common/ctx.js";
import { DB, type Db, type Tx } from "../db/db.js";
import { auditLog } from "../db/schema.js";

export interface AuditEntry {
  /** Dotted action name such as printer.release or settings.update. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  /** Never credentials. */
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  result?: "OK" | "FAILED" | "DENIED";
}

/** The append-only audit log. Pass the transaction of the change being recorded so both commit together. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(ctx: Ctx, e: AuditEntry, tx: Tx = this.db) {
    await tx.insert(auditLog).values({
      ...actorColumns(ctx),
      action: e.action,
      targetType: e.targetType ?? null,
      targetId: e.targetId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      reason: e.reason ?? null,
      result: e.result ?? "OK",
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}
