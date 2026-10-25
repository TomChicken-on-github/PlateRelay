import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userId } from "../auth/actor.js";
import { sha256 } from "../auth/tokens.js";
import { notFound } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { daemons } from "../db/schema.js";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** plr_ + 40 base32 characters (200 bits). */
export const newDaemonToken = () => "plr_" + Array.from({ length: 40 }, () => B32[randomInt(32)]).join("");

const view = (d: typeof daemons.$inferSelect) => ({
  id: d.id,
  name: d.name,
  network: d.network,
  enabled: d.enabled,
  tokenTail: d.tokenTail,
  createdAt: d.createdAt.toISOString(),
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
});

/** Daemon tokens. The token is shown once on creation; only its hash and last four characters are kept. */
@Injectable()
export class DaemonsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.db.select().from(daemons).orderBy(asc(daemons.createdAt))).map(view);
  }

  async create(ctx: Ctx, name: string, network: string | null) {
    const token = newDaemonToken();
    return this.db.transaction(async (tx) => {
      const [d] = await tx.insert(daemons).values({ name, network, tokenHash: sha256(token), tokenTail: token.slice(-4), createdBy: userId(ctx) }).returning();
      await this.audit.record(ctx, { action: "daemon.create", targetType: "daemon", targetId: d.id, after: { name, network, tokenTail: d.tokenTail } }, tx);
      return { ...view(d), token };
    });
  }

  async setEnabled(ctx: Ctx, id: string, enabled: boolean) {
    return this.db.transaction(async (tx) => {
      const [d] = await tx.update(daemons).set({ enabled }).where(eq(daemons.id, id)).returning();
      if (!d) throw notFound("daemon");
      await this.audit.record(ctx, { action: enabled ? "daemon.enable" : "daemon.disable", targetType: "daemon", targetId: id }, tx);
      return view(d);
    });
  }

  async remove(ctx: Ctx, id: string) {
    await this.db.transaction(async (tx) => {
      const [d] = await tx.delete(daemons).where(eq(daemons.id, id)).returning();
      if (!d) throw notFound("daemon");
      await this.audit.record(ctx, { action: "daemon.delete", targetType: "daemon", targetId: id, before: { name: d.name, tokenTail: d.tokenTail } }, tx);
    });
  }

  /** For the daemon link: the enabled daemon a token belongs to. */
  async byToken(token: string) {
    const [d] = await this.db.select().from(daemons).where(eq(daemons.tokenHash, sha256(token)));
    return d?.enabled ? d : null;
  }
}
