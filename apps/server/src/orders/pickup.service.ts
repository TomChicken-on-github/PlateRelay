import { randomInt } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userId } from "../auth/actor.js";
import { ApiError, notFound } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { files, orders, pickupCodes } from "../db/schema.js";
import { STORAGE, type ObjectStorage } from "../storage/storage.js";
import { transition } from "./transition.js";
import { loadPeople, THUMB_TTL_S } from "./views.js";

/** A code is good for ten minutes, so a screenshot passed to someone else soon stops working. */
export const PICKUP_TTL_MS = 10 * 60 * 1000;

/* Crockford base32: no I, L, O, U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** "pr1-7k3q 92ab", "7K3Q92AB" … → "7K3Q92AB"; null when it cannot be a code. */
export function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (s.length === 11 && s.startsWith("PR1")) s = s.slice(3);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  return s.length === 8 && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

export const formatCode = (c: string) => `PR1-${c.slice(0, 4)}-${c.slice(4)}`;

const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

@Injectable()
export class PickupService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
  ) {}

  /** Issued to the order's owner on demand; a new code revokes the previous one at once. */
  async issue(ctx: Ctx, orderId: number): Promise<{ code: string; expiresAt: string }> {
    return this.db.transaction(async (tx) => {
      const [o] = await tx.select({ ownerId: orders.ownerId, status: orders.status }).from(orders).where(eq(orders.id, orderId)).for("update");
      if (!o || o.ownerId !== userId(ctx)) throw notFound("订单");
      if (o.status !== "STORED_READY_PICKUP") throw new ApiError(HttpStatus.CONFLICT, "order-not-ready", "订单还不能取件", { orderId, status: o.status });
      const now = new Date();
      await tx.update(pickupCodes).set({ revokedAt: now }).where(and(eq(pickupCodes.orderId, orderId), isNull(pickupCodes.revokedAt), isNull(pickupCodes.redeemedAt)));
      const expiresAt = new Date(now.getTime() + PICKUP_TTL_MS);
      let code = newCode();
      /* 32^8 codes; a clash is practically impossible but cheap to rule out */
      while ((await tx.select({ id: pickupCodes.id }).from(pickupCodes).where(eq(pickupCodes.code, code))).length) code = newCode();
      await tx.insert(pickupCodes).values({ code, orderId, issuedAt: now, expiresAt });
      await this.audit.record(ctx, { action: "pickup.issue", targetType: "order", targetId: orderId, after: { expiresAt: expiresAt.toISOString() } }, tx);
      return { code: formatCode(code), expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * Resolves a code to its order or throws the refusal the scan page shows.
   * Order of checks: already redeemed, revoked, expired, not ready.
   */
  private async check(db: Db, raw: string, lock: boolean) {
    const code = normalizeCode(raw);
    const [pc] = code ? await db.select().from(pickupCodes).where(eq(pickupCodes.code, code)) : [];
    if (!pc) throw new ApiError(HttpStatus.NOT_FOUND, "pickup-code-invalid", "取件码无效");
    const q = db.select().from(orders).where(eq(orders.id, pc.orderId));
    const [o] = lock ? await q.for("update") : await q;
    if (o.status === "COMPLETED") {
      const people = await loadPeople(db, [o.ownerId, o.redeemedBy]);
      throw new ApiError(HttpStatus.CONFLICT, "pickup-already-redeemed", "这张单已经核销过了", {
        orderId: o.id,
        owner: { name: people.get(o.ownerId)!.name },
        redeemedAt: o.redeemedAt?.toISOString() ?? null,
        redeemedBy: o.redeemedBy ? { name: people.get(o.redeemedBy)!.name } : null,
      });
    }
    if (pc.revokedAt) throw new ApiError(HttpStatus.NOT_FOUND, "pickup-code-invalid", "取件码已失效，请让选手重新出示");
    if (pc.expiresAt.getTime() <= Date.now()) {
      throw new ApiError(HttpStatus.GONE, "pickup-code-expired", "取件码已过期，请让选手重新出示", { orderId: o.id, expiresAt: pc.expiresAt.toISOString() });
    }
    if (o.status !== "STORED_READY_PICKUP") throw new ApiError(HttpStatus.CONFLICT, "order-not-ready", "订单还没入库", { orderId: o.id, status: o.status });
    return { pc, o };
  }

  async lookup(raw: string) {
    const { o } = await this.check(this.db, raw, false);
    const [f] = await this.db.select({ name: files.fileName }).from(files).where(eq(files.id, o.fileId));
    const people = await loadPeople(this.db, [o.ownerId]);
    const owner = people.get(o.ownerId)!;
    return {
      orderId: o.id,
      fileName: f.name,
      plateIndex: o.plateIndex,
      plateCount: o.plateCount,
      printerModel: o.printerModel,
      weightG: o.weightGrams,
      filaments: o.filaments.map((x) => ({ color: x.color, type: x.type })),
      owner: { name: owner.name, role: owner.role },
      slot: o.storageSlot,
      storedAt: o.storedAt?.toISOString() ?? null,
      thumbUrl: o.thumbnailKey ? await this.storage.signedUrl(o.thumbnailKey, THUMB_TTL_S) : null,
    };
  }

  async redeem(ctx: Ctx, raw: string) {
    try {
      return await this.db.transaction(async (tx) => {
        const { pc, o } = await this.check(tx, raw, true);
        const now = new Date();
        await transition(tx, ctx, o.id, "redeem", { set: { redeemedBy: userId(ctx), redeemedAt: now } });
        await tx.update(pickupCodes).set({ redeemedAt: now }).where(eq(pickupCodes.id, pc.id));
        await this.audit.record(ctx, { action: "order.redeem", targetType: "order", targetId: o.id, before: { status: "STORED_READY_PICKUP" }, after: { status: "COMPLETED" } }, tx);
        const by = ctx.actor.type === "user" ? ctx.actor.displayName : "系统";
        return { orderId: o.id, redeemedAt: now.toISOString(), redeemedBy: { name: by } };
      });
    } catch (e) {
      if (e instanceof ApiError) {
        const body = e.getResponse() as { code: string; orderId?: number };
        await this.audit.record(ctx, { action: "order.redeem", targetType: "order", targetId: body.orderId ?? null, reason: body.code, result: "failed" });
      }
      throw e;
    }
  }

  /** Redemptions since a time, newest first: the scan page's "today" list. */
  async redemptions(since: Date) {
    const rows = await this.db
      .select({ id: orders.id, ownerId: orders.ownerId, at: orders.redeemedAt, file: files.fileName })
      .from(orders)
      .innerJoin(files, eq(files.id, orders.fileId))
      .where(and(eq(orders.status, "COMPLETED"), gte(orders.redeemedAt, since)))
      .orderBy(desc(orders.redeemedAt));
    const people = await loadPeople(this.db, rows.map((r) => r.ownerId));
    return rows.map((r) => ({ orderId: r.id, fileName: r.file, owner: { name: people.get(r.ownerId)!.name }, redeemedAt: r.at!.toISOString() }));
  }
}
