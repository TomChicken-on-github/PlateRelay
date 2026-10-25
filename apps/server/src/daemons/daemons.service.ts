import { createHash, createPublicKey, randomInt } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ACCESS_CODE_MIN_KEY_BITS, type DaemonKeyView, type DaemonView } from "@platerelay/shared";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userId } from "../auth/actor.js";
import { sha256 } from "../auth/tokens.js";
import { ApiError, notFound } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { daemons, printers } from "../db/schema.js";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** plr_ + 40 base32 characters (200 bits). */
export const newDaemonToken = () => "plr_" + Array.from({ length: 40 }, () => B32[randomInt(32)]).join("");

/** Same id the browser computes (shared accessCodeKeyId): first 16 hex of SHA-256 over the SPKI DER. */
export const keyIdOf = (der: Buffer) => createHash("sha256").update(der).digest("hex").slice(0, 16);

/** Modulus size in bytes of a stored public key, which is also the RSA-OAEP ciphertext length. */
export const modulusBytes = (publicKeyB64: string) => (createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" }).asymmetricKeyDetails?.modulusLength ?? 0) / 8;

const view = (d: typeof daemons.$inferSelect): DaemonView => ({
  id: d.id,
  name: d.name,
  network: d.network,
  enabled: d.enabled,
  tokenTail: d.tokenTail,
  createdAt: d.createdAt.toISOString(),
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  keyId: d.keyId,
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

  /** Enabled daemons with the key a browser encrypts access codes with (打印机管理). */
  async keys(): Promise<DaemonKeyView[]> {
    const rows = await this.db.select().from(daemons).where(eq(daemons.enabled, true)).orderBy(asc(daemons.createdAt));
    return rows.map((d) => ({ id: d.id, name: d.name, network: d.network, keyId: d.keyId, publicKey: d.publicKey }));
  }

  /**
   * For the daemon link: the daemon reports its public key (SPKI DER, base64) when it connects.
   * Reporting the same key again changes nothing. A new key leaves the stored access codes
   * unreadable for it; they stay marked as stale until someone enters them again.
   */
  async setPublicKey(daemonId: string, publicKeyB64: string) {
    const der = Buffer.from(publicKeyB64, "base64");
    let bits = 0;
    try {
      const k = createPublicKey({ key: der, format: "der", type: "spki" });
      bits = k.asymmetricKeyType === "rsa" ? (k.asymmetricKeyDetails?.modulusLength ?? 0) : 0;
    } catch {
      /* not a key */
    }
    if (bits < ACCESS_CODE_MIN_KEY_BITS) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-key", `需要至少 ${ACCESS_CODE_MIN_KEY_BITS} 位的 RSA 公钥`);
    const keyId = keyIdOf(der);
    return this.db.transaction(async (tx) => {
      const [cur] = await tx.select().from(daemons).where(eq(daemons.id, daemonId)).for("update");
      if (!cur) throw notFound("daemon");
      if (cur.keyId === keyId) return { keyId, changed: false };
      await tx.update(daemons).set({ publicKey: der.toString("base64"), keyId, keySetAt: new Date() }).where(eq(daemons.id, daemonId));
      const stale = await tx.select({ id: printers.id }).from(printers).where(and(eq(printers.daemonId, daemonId), isNotNull(printers.accessCodeCipher)));
      await this.audit.record(
        { actor: { type: "daemon", id: daemonId }, ip: null, device: null },
        { action: "daemon.key.set", targetType: "daemon", targetId: daemonId, before: { keyId: cur.keyId }, after: { keyId, staleAccessCodes: stale.length } },
        tx,
      );
      return { keyId, changed: true };
    });
  }

  /** For the daemon link: the enabled daemon a token belongs to. */
  async byToken(token: string) {
    const [d] = await this.db.select().from(daemons).where(eq(daemons.tokenHash, sha256(token)));
    return d?.enabled ? d : null;
  }
}
