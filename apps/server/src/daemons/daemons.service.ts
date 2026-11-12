import { constants, createHash, createPublicKey, verify } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { newToken, sha256 } from "../auth/tokens.js";
import { type Ctx, SYSTEM, userIdOf } from "../common/ctx.js";
import { notFound, Problem, versionConflict } from "../common/problem.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { Work } from "../core/uow.js";
import { DB, type Db } from "../db/db.js";
import { daemonEnrollments, daemons, printers } from "../db/schema.js";
import { addReason, settlePrinter } from "../jobs/printer-state.js";
import { DaemonHub } from "./hub.js";

const ENROLLMENT_MS = 15 * 60 * 1000;
export const AUTH_CONTEXT = "platerelay-daemon-auth/v1";

export type DaemonRow = typeof daemons.$inferSelect;

/** SHA-256 of the key's SPKI DER, lowercase hex: what an admin compares between the panel and the daemon's machine. */
export function keyFingerprint(spkiBase64: string): string {
  return createHash("sha256").update(Buffer.from(spkiBase64, "base64")).digest("hex");
}

/**
 * Daemons known to the panel. A daemon makes its own key pair and hands over only the public key,
 * once, with a short-lived enrollment token an admin created; from then on it proves who it is by
 * signing a fresh challenge on every connection.
 */
@Injectable()
export class DaemonsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly work: Work,
    private readonly hub: DaemonHub,
    private readonly audit: AuditService,
  ) {}

  private async view(d: DaemonRow) {
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(printers).where(eq(printers.daemonId, d.id));
    return {
      id: d.id,
      name: d.name,
      online: this.hub.isOnline(d.id),
      daemonVersion: d.daemonVersion,
      protocolVersion: d.protocolVersion,
      platform: d.platform,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      revokedAt: d.revokedAt?.toISOString() ?? null,
      keyAlertAt: null,
      keyFingerprint: d.keyFingerprint,
      printerCount: n,
      needsUpgrade: false,
      version: d.version,
    };
  }

  async get(daemonId: string): Promise<DaemonRow> {
    const [d] = await this.db.select().from(daemons).where(eq(daemons.id, daemonId));
    if (!d) throw notFound("daemon");
    return d;
  }

  async list() {
    return Promise.all((await this.db.select().from(daemons).orderBy(asc(daemons.createdAt))).map((d) => this.view(d)));
  }

  async publicKey(daemonId: string) {
    const d = await this.get(daemonId);
    return { publicKey: d.publicKey, keyFingerprint: d.keyFingerprint };
  }

  /** A one-time token, shown once inside the commands to run on the daemon's machine. Only its hash is kept. */
  async createEnrollment(ctx: Ctx, name: string) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + ENROLLMENT_MS);
    const [row] = await this.db.transaction(async (tx) => {
      const out = await tx.insert(daemonEnrollments).values({ tokenHash: sha256(token), expiresAt, createdBy: userIdOf(ctx) }).returning();
      await this.audit.record(ctx, { action: "daemon.enrollment.create", targetType: "daemon_enrollment", targetId: out[0].id, after: { name } }, tx);
      return out;
    });
    /* The token goes in through the environment, so it stays out of the process list and the shell history. */
    const run = `run --panel ${this.config.publicOrigin} --name ${JSON.stringify(name)}`;
    return {
      id: row.id,
      expiresAt: expiresAt.toISOString(),
      commands: {
        linux: `PLATERELAY_ENROLL_TOKEN=${token} platerelay-daemon ${run}`,
        windows: `$env:PLATERELAY_ENROLL_TOKEN="${token}"; platerelay-daemon ${run}`,
        docker: `docker run -d --network host -e PLATERELAY_ENROLL_TOKEN=${token} -v platerelay-daemon:/data platerelay/daemon ${run}`,
      },
    };
  }

  async rename(ctx: Ctx, daemonId: string, b: { version: number; name: string }) {
    const d = await this.get(daemonId);
    if (d.version !== b.version) throw versionConflict(d.version);
    await this.db.transaction(async (tx) => {
      await tx
        .update(daemons)
        .set({ name: b.name, version: d.version + 1 })
        .where(eq(daemons.id, d.id));
      await this.audit.record(ctx, { action: "daemon.rename", targetType: "daemon", targetId: d.id, before: { name: d.name }, after: { name: b.name } }, tx);
    });
    return this.view(await this.get(daemonId));
  }

  /** A revoked daemon is cut off at once and refused from then on; its printers become unreachable. */
  async revoke(ctx: Ctx, daemonId: string, b: { version: number; reason: string }) {
    const d = await this.get(daemonId);
    if (d.version !== b.version) throw versionConflict(d.version);
    await this.work.run(async (u) => {
      await u.tx
        .update(daemons)
        .set({ revokedAt: d.revokedAt ?? new Date(), version: d.version + 1 })
        .where(eq(daemons.id, d.id));
      for (const { id } of await u.tx.select({ id: printers.id }).from(printers).where(eq(printers.daemonId, d.id)).for("update")) {
        await addReason(u, id, "OFFLINE", { data: { why: "daemon_revoked" } });
        await settlePrinter(u, id);
      }
      await this.audit.record(ctx, { action: "daemon.revoke", targetType: "daemon", targetId: d.id, reason: b.reason }, u.tx);
    });
    this.hub.get(d.id)?.close(4403, "revoked");
    return this.view(await this.get(daemonId));
  }

  /* ───────── the daemon's side ───────── */

  async enroll(b: { token: string; publicKey: string; name: string; platform: string; daemonVersion: string; protocolVersion: string }): Promise<{ daemonId: string }> {
    try {
      const key = createPublicKey({ key: Buffer.from(b.publicKey, "base64"), format: "der", type: "spki" });
      if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("not an RSA key of at least 2048 bits");
    } catch {
      throw new Problem(422, "bad_public_key", "publicKey must be an RSA public key (2048 bits or more), SPKI DER as base64");
    }
    const fingerprint = keyFingerprint(b.publicKey);
    /* Development only: a fixed token from the environment that can be used again, so a daemon started from scratch enrolls without the admin page. */
    const dev = !!this.config.devEnrollToken && b.token === this.config.devEnrollToken;
    return this.db.transaction(async (tx) => {
      const [enrollment] = dev
        ? []
        : await tx
            .select()
            .from(daemonEnrollments)
            .where(and(eq(daemonEnrollments.tokenHash, sha256(b.token)), isNull(daemonEnrollments.usedAt), gt(daemonEnrollments.expiresAt, new Date())))
            .for("update");
      if (!dev && !enrollment) throw new Problem(401, "bad_enrollment_token", "the enrollment token is wrong, used or expired");
      const [known] = await tx.select().from(daemons).where(eq(daemons.keyFingerprint, fingerprint));
      if (known && !dev) throw new Problem(409, "already_enrolled", "a daemon with this key is already enrolled");
      const d = known ?? (await tx.insert(daemons).values({ name: b.name, publicKey: b.publicKey, keyFingerprint: fingerprint, protocolVersion: b.protocolVersion, daemonVersion: b.daemonVersion, platform: b.platform, createdBy: enrollment?.createdBy ?? null }).returning())[0];
      if (enrollment) await tx.update(daemonEnrollments).set({ usedAt: new Date(), daemonId: d.id }).where(eq(daemonEnrollments.id, enrollment.id));
      if (!known) await this.audit.record(SYSTEM, { action: "daemon.enroll", targetType: "daemon", targetId: d.id, after: { name: d.name, keyFingerprint: fingerprint, platform: d.platform } }, tx);
      return { daemonId: d.id };
    });
  }

  /**
   * Checks the daemon's answer to a challenge: an RSA-PSS signature (SHA-256, 32-byte salt) over
   * the daemon's id, the nonce and the panel's origin. Binding the origin keeps a signature made
   * for one panel from being replayed to another.
   */
  verifySignature(d: DaemonRow, nonce: string, signatureBase64: string, origins: string[]): boolean {
    let key;
    try {
      key = createPublicKey({ key: Buffer.from(d.publicKey, "base64"), format: "der", type: "spki" });
    } catch {
      return false;
    }
    const signature = Buffer.from(signatureBase64, "base64");
    return origins.some((origin) => verify("sha256", Buffer.from(`${AUTH_CONTEXT}\n${d.id}\n${nonce}\n${origin}`), { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }, signature));
  }

  async seen(daemonId: string, hello: { protocolVersion: string; daemonVersion: string; platform: string }) {
    await this.db.update(daemons).set({ lastSeenAt: new Date(), protocolVersion: hello.protocolVersion, daemonVersion: hello.daemonVersion, platform: hello.platform }).where(eq(daemons.id, daemonId));
  }
}
