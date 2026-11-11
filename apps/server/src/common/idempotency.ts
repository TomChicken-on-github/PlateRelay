import { createHash } from "node:crypto";
import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import { operations } from "@platerelay/shared/contract/http";
import { and, eq, lt } from "drizzle-orm";
import type { Response } from "express";
import { from, lastValueFrom, type Observable } from "rxjs";
import { DB, type Db } from "../db/db.js";
import { idempotencyKeys } from "../db/schema.js";
import type { PanelRequest } from "./ctx.js";
import { opOf } from "./op.js";
import { Problem, problemBody } from "./problem.js";

/* Sign-in, sign-out and the presence heartbeat are safe to repeat as they are. */
const EXEMPT = new Set(["login", "logout", "putPrinterPresence", "deletePrinterPresence"]);
const KEEP_MS = 24 * 3600 * 1000;

/** Stable JSON: object keys sorted, so the same body always hashes the same. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/**
 * Every write carries an Idempotency-Key: one key per thing the user meant to do, reused for
 * network retries and double clicks. The first answer is kept for 24 hours and replayed for the
 * same key; the same key with a different body is refused. Server errors and rate limits are not
 * kept, so a retry runs again.
 *
 * The record is written around the handler, not inside its transaction: a crash between the two
 * leaves the key "in progress" until it expires.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: Db) {}

  intercept(ec: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ec.switchToHttp().getRequest<PanelRequest>();
    const id = opOf(req);
    if (!id || operations[id].method === "GET" || EXEMPT.has(id)) return next.handle();
    return from(this.run(req, ec.switchToHttp().getResponse<Response>(), id, next));
  }

  private async run(req: PanelRequest, res: Response, id: string, next: CallHandler): Promise<unknown> {
    const key = req.get("idempotency-key");
    if (!key) throw new Problem(428, "idempotency_key_required", "write requests need an Idempotency-Key header");
    if (key.length < 8 || key.length > 128) throw new Problem(400, "bad_request", "Idempotency-Key must be 8 to 128 characters");
    const actor = req.ctx!.actor;
    const where = { principal: actor.type === "USER" ? `user:${actor.id}` : `guest:${req.ip ?? ""}`, method: req.method, route: id, key };
    const file = (req as PanelRequest & { file?: { size: number } }).file;
    const requestHash = createHash("sha256")
      .update(canonical({ params: req.params, body: req.body ?? null, file: file?.size ?? null }))
      .digest("hex");
    const match = and(eq(idempotencyKeys.principal, where.principal), eq(idempotencyKeys.method, where.method), eq(idempotencyKeys.route, where.route), eq(idempotencyKeys.key, key));

    await this.db.delete(idempotencyKeys).where(and(match, lt(idempotencyKeys.expiresAt, new Date())));
    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({ ...where, requestHash, expiresAt: new Date(Date.now() + KEEP_MS) })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (!inserted.length) {
      const [seen] = await this.db.select().from(idempotencyKeys).where(match);
      if (seen && seen.requestHash !== requestHash) throw new Problem(409, "idempotency_key_reused", "this key was used with a different request");
      if (!seen || seen.statusCode === null) throw new Problem(409, "idempotency_in_progress", "the first request with this key is still running");
      res.setHeader("Idempotent-Replayed", "true");
      res.status(seen.statusCode);
      if (seen.statusCode >= 400) res.type("application/problem+json");
      return seen.response ?? undefined;
    }
    try {
      const body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      await this.db
        .update(idempotencyKeys)
        .set({ statusCode: res.statusCode, response: body ?? null })
        .where(match);
      return body;
    } catch (e) {
      const status = e instanceof Problem ? e.getStatus() : 500;
      if (e instanceof Problem && status < 500 && status !== 429) {
        await this.db
          .update(idempotencyKeys)
          .set({ statusCode: status, response: problemBody(status, e.code, req.requestId ?? "", e) })
          .where(match);
      } else await this.db.delete(idempotencyKeys).where(match);
      throw e;
    }
  }
}
