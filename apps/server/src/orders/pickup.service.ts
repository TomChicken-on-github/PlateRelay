import { createHmac, randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gt, isNotNull, isNull, lt } from "drizzle-orm";
import { type Ctx, userIdOf } from "../common/ctx.js";
import { notFound, Problem, stateConflict } from "../common/problem.js";
import { Work } from "../core/uow.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { DB, type Db } from "../db/db.js";
import { orders, pickupCodes } from "../db/schema.js";
import { SettingsService } from "../settings/settings.service.js";
import { type ObjectStorage, STORAGE } from "../storage/storage.js";
import { OrdersService } from "./orders.service.js";
import { record } from "./records.js";
import { OrderViews } from "./views.js";

/* Crockford base32: no I, L, O or U, so a code read aloud or typed from a screen is hard to get wrong. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PREFIX = "PR1";

export function newPickupCode(): string {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(32)]).join("");
  return `${PREFIX}-${pick(4)}-${pick(4)}`;
}

/** What people type or scan, brought to the one form codes are stored in: upper case, look-alike letters mapped, dashes optional. */
export function normalizePickupCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const m = new RegExp(`^${PREFIX}([${ALPHABET}]{4})([${ALPHABET}]{4})$`).exec(s);
  return m ? `${PREFIX}-${m[1]}-${m[2]}` : null;
}

/**
 * Pickup codes. The code is the only proof needed to collect a print; whoever shows it gets the
 * print. Only a keyed hash is stored, each order has one valid code at a time, and a code works once.
 */
@Injectable()
export class PickupService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly work: Work,
    private readonly ordersService: OrdersService,
    private readonly views: OrderViews,
    private readonly settings: SettingsService,
  ) {}

  private hash(code: string): string {
    return createHmac("sha256", this.config.secret).update(`pickup\n${code}`).digest("hex");
  }

  /** A new code for the applicant's own order; the previous one stops working. */
  async issue(ctx: Ctx, orderId: string) {
    const { codeMinutes } = await this.settings.get("pickup");
    return this.work.run(async (u) => {
      const [o] = await u.tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!o || o.ownerId !== userIdOf(ctx)) throw notFound("order");
      if (o.status !== "READY") throw stateConflict(o.status, "READY");
      await u.tx
        .update(pickupCodes)
        .set({ revokedAt: new Date() })
        .where(and(eq(pickupCodes.orderId, o.id), isNull(pickupCodes.revokedAt), isNull(pickupCodes.redeemedAt)));
      const code = newPickupCode();
      const expiresAt = new Date(Date.now() + codeMinutes * 60_000);
      await u.tx.insert(pickupCodes).values({ orderId: o.id, codeHash: this.hash(code), expiresAt });
      await record(u, ctx, { orderId: o.id, kind: "pickup.code_issued", noteVisible: true });
      return { code, expiresAt: expiresAt.toISOString() };
    });
  }

  /** The valid code row for what was typed, or a refusal that does not say why (wrong, expired, replaced and used all look the same). */
  private async find(input: string, tx: Db = this.db) {
    const code = normalizePickupCode(input);
    const [row] = code
      ? await tx
          .select()
          .from(pickupCodes)
          .where(and(eq(pickupCodes.codeHash, this.hash(code)), isNull(pickupCodes.revokedAt), isNull(pickupCodes.redeemedAt), gt(pickupCodes.expiresAt, new Date())))
      : [];
    if (!row) throw new Problem(404, "pickup_code_invalid", "no valid pickup code like that");
    return row;
  }

  async lookup(ctx: Ctx, input: string) {
    const row = await this.find(input);
    const [o] = await this.db.select().from(orders).where(eq(orders.id, row.orderId));
    if (o.status !== "READY") throw new Problem(404, "pickup_code_invalid", "no valid pickup code like that");
    return {
      order: await this.views.summary(ctx, o),
      storageSlot: o.storageSlot ?? "",
      photoUrl: o.storePhotoKey ? await this.storage.signedUrl(o.storePhotoKey, 300) : null,
      codeExpiresAt: row.expiresAt.toISOString(),
    };
  }

  async redeem(ctx: Ctx, input: string) {
    const orderId = await this.work.run(async (u) => {
      const seen = await this.find(input, u.tx);
      const o = await this.ordersService.complete(u, ctx, seen.orderId);
      /* Checked again under the order's lock: of two scans at once only one finds the code unused. */
      const used = await u.tx
        .update(pickupCodes)
        .set({ redeemedAt: new Date(), redeemedBy: userIdOf(ctx) })
        .where(and(eq(pickupCodes.id, seen.id), isNull(pickupCodes.redeemedAt), isNull(pickupCodes.revokedAt)))
        .returning({ id: pickupCodes.id });
      if (!used.length) throw new Problem(404, "pickup_code_invalid", "no valid pickup code like that");
      return o.id;
    });
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    return this.views.summary(ctx, o);
  }

  async redemptions(ctx: Ctx, q: { limit?: string; cursor?: string }) {
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    const rows = await this.db
      .select({ code: pickupCodes, order: orders })
      .from(pickupCodes)
      .innerJoin(orders, eq(orders.id, pickupCodes.orderId))
      .where(and(isNotNull(pickupCodes.redeemedAt), q.cursor ? lt(pickupCodes.id, q.cursor) : undefined))
      .orderBy(desc(pickupCodes.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const summaries = await this.views.summaries(
      ctx,
      page.map((r) => r.order),
    );
    const people = await this.views.people(page.map((r) => r.code.redeemedBy));
    return {
      items: page.map((r, i) => {
        const by = r.code.redeemedBy ? people.get(r.code.redeemedBy) : undefined;
        return { order: summaries[i], redeemedAt: r.code.redeemedAt!.toISOString(), redeemedBy: { id: by?.id ?? null, name: by?.displayName ?? "", avatarUrl: null } };
      }),
      nextCursor: rows.length > limit ? page[page.length - 1].code.id : null,
    };
  }
}
