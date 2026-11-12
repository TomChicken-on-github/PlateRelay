import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { type DaemonMessage, daemonProtocolVersion, needsAck, parseDaemonMessage } from "@platerelay/shared/contract/daemon";
import { and, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { type WebSocket, WebSocketServer } from "ws";
import { newToken } from "../auth/tokens.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { type Uow, Work } from "../core/uow.js";
import { DB, type Db } from "../db/db.js";
import { daemonCommands, daemonInbox, printerLive, printers, printJobs } from "../db/schema.js";
import { FactsService } from "../printers/facts.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { type DaemonRow, DaemonsService } from "./daemons.service.js";
import { type DaemonLink, DaemonHub } from "./hub.js";

export const DAEMON_WS_PATH = "/daemon/v1/ws";
const HANDSHAKE_MS = 10_000;
const HTTP_TOKEN_MS = 30 * 24 * 3600 * 1000;
const SWEEP_MS = 5000;

interface Conn extends DaemonLink {
  ws: WebSocket;
  lastHeard: number;
  httpToken: string;
}

/**
 * The control channel: one WebSocket per daemon, JSON text frames. A daemon says who it is, signs
 * the panel's challenge, and from then on reports its printers and takes commands. Reports that
 * matter are numbered by the daemon, acknowledged here, and applied once even if they arrive twice.
 */
@Injectable()
export class DaemonGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("DaemonGateway");
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  private readonly conns = new Set<Conn>();
  private readonly httpTokens = new Map<string, string>();
  private sweep: NodeJS.Timeout | null = null;
  private server: Server | null = null;
  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== DAEMON_WS_PATH) return;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, req));
  };

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly host: HttpAdapterHost,
    private readonly hub: DaemonHub,
    private readonly daemons: DaemonsService,
    private readonly facts: FactsService,
    private readonly settings: SettingsService,
    work: Work,
  ) {
    work.afterCommit((u) => this.afterCommit(u));
  }

  async onApplicationBootstrap() {
    /* No daemon is connected when the panel starts, so nothing stored about reachability holds. */
    await this.facts.allUnreachable();
    this.server = this.host.httpAdapter.getHttpServer() as Server;
    this.server.on("upgrade", this.onUpgrade);
    this.sweep = setInterval(() => void this.tick().catch((e) => this.log.error(e)), SWEEP_MS);
    this.sweep.unref();
  }

  onModuleDestroy() {
    if (this.sweep) clearInterval(this.sweep);
    this.server?.off("upgrade", this.onUpgrade);
    for (const c of this.conns) c.ws.terminate();
    this.wss.close();
  }

  /** The daemon a bearer token of the file and photo endpoints belongs to; the token dies with its connection. */
  daemonForToken(token: string): string | undefined {
    return this.httpTokens.get(token);
  }

  /* ───────── handshake ───────── */

  private accept(ws: WebSocket, req: IncomingMessage) {
    const nonce = randomBytes(32).toString("base64url");
    let stage: "hello" | "auth" | "open" = "hello";
    let daemon: DaemonRow | undefined;
    let hello: Extract<DaemonMessage, { type: "hello" }>["body"] | undefined;
    let conn: Conn | undefined;
    /* Messages of one connection are handled one after another, in the order they came. */
    let chain: Promise<void> = Promise.resolve();
    const raw = (type: string, body: unknown, id: string = randomUUID()) => {
      if (ws.readyState !== ws.OPEN) return false;
      ws.send(JSON.stringify({ id, type, ts: new Date().toISOString(), body }));
      return true;
    };
    const timer = setTimeout(() => stage !== "open" && ws.close(4401, "handshake timed out"), HANDSHAKE_MS);

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      chain = chain
        .then(async () => {
          let frame: unknown;
          try {
            frame = JSON.parse(String(data));
          } catch {
            return;
          }
          const parsed = parseDaemonMessage(frame);
          if (!parsed.ok) {
            /* A message the panel cannot use is acknowledged and dropped, so it does not block what comes after it. */
            if (parsed.reason !== "invalid_envelope") {
              if (parsed.reason === "invalid_body") this.log.warn(`daemon ${daemon?.id ?? "?"} sent a bad ${parsed.type}: ${JSON.stringify(parsed.issues).slice(0, 500)}`);
              if (stage === "open") raw("ack", { id: parsed.id });
            }
            return;
          }
          const m = parsed.message;
          if (stage === "hello") {
            if (m.type !== "hello") return ws.close(4401, "expected hello");
            hello = m.body;
            daemon = await this.daemons.get(m.body.daemonId).catch(() => undefined);
            if (daemon?.revokedAt) return ws.close(4403, "revoked");
            if (m.body.protocolVersion.split(".")[0] !== daemonProtocolVersion.split(".")[0]) {
              raw("upgrade_required", { minProtocolVersion: daemonProtocolVersion, upgradeCommand: "" });
              return ws.close(4426, "protocol version not supported");
            }
            stage = "auth";
            raw("challenge", { nonce, serverTime: new Date().toISOString() });
          } else if (stage === "auth") {
            if (m.type !== "auth" || !daemon || !this.daemons.verifySignature(daemon, nonce, m.body.signature, this.origins(req))) return ws.close(4401, "bad signature");
            stage = "open";
            clearTimeout(timer);
            conn = await this.open(ws, daemon, hello!, raw);
          } else await this.handle(conn!, m);
        })
        .catch((e) => this.log.error(e instanceof Error ? (e.stack ?? e.message) : String(e)));
    });
    ws.on("close", () => {
      clearTimeout(timer);
      if (conn) void chain.then(() => this.closed(conn!));
    });
    ws.on("error", () => ws.terminate());
  }

  /* The origin the daemon signed. In development the daemon may reach the panel under another name than the configured one (127.0.0.1 instead of localhost). */
  private origins(req: IncomingMessage): string[] {
    const out = [this.config.publicOrigin];
    if (process.env.NODE_ENV !== "production" && req.headers.host) out.push(`http://${req.headers.host}`, `https://${req.headers.host}`, `ws://${req.headers.host}`, `wss://${req.headers.host}`);
    return out;
  }

  private async open(ws: WebSocket, d: DaemonRow, hello: { protocolVersion: string; daemonVersion: string; platform: string }, raw: (type: string, body: unknown, id?: string) => boolean): Promise<Conn> {
    const conn: Conn = { daemonId: d.id, sessionId: randomUUID(), ws, lastHeard: Date.now(), httpToken: newToken(), send: raw, close: (code, reason) => ws.close(code, reason) };
    /* The newer connection of a daemon wins. */
    const old = this.hub.attach(conn);
    old?.close(4409, "replaced by a newer connection");
    this.conns.add(conn);
    this.httpTokens.set(conn.httpToken, d.id);
    await this.daemons.seen(d.id, hello);
    const camera = await this.settings.get("camera");
    const printing = await this.settings.get("printing");
    conn.send("welcome", {
      sessionId: conn.sessionId,
      protocolVersion: daemonProtocolVersion,
      serverTime: new Date().toISOString(),
      heartbeatSeconds: this.config.daemonHeartbeatSeconds,
      httpToken: conn.httpToken,
      httpTokenExpiresAt: new Date(Date.now() + HTTP_TOKEN_MS).toISOString(),
      printers: await this.assigned(d.id),
      config: { snapshot: { watchedSeconds: camera.watchedSnapshotSeconds, unwatchedSeconds: camera.unwatchedSnapshotMinutes * 60, staggerSeconds: 1, uploadKbps: Math.round(camera.snapshotUploadMbps * 1000) }, transferTimeoutSeconds: printing.transferTimeoutSeconds, downloadConcurrency: 2, discoveryEnabled: true },
    });
    this.log.log(`daemon ${d.name} (${d.id}) connected`);
    await this.deliver(d.id);
    return conn;
  }

  private async closed(conn: Conn) {
    this.conns.delete(conn);
    this.httpTokens.delete(conn.httpToken);
    /* Replaced by a newer connection: the daemon is still there. */
    if (!this.hub.detach(conn)) return;
    this.log.warn(`daemon ${conn.daemonId} disconnected`);
    await this.facts.daemonLost(conn.daemonId);
  }

  /** The printers a daemon looks after, with what it needs to tell the panel's jobs from anything else on the machine. */
  private async assigned(daemonId: string) {
    const rows = await this.db
      .select({ p: printers, runSeq: printerLive.runSeq })
      .from(printers)
      .leftJoin(printerLive, eq(printerLive.printerId, printers.id))
      .where(and(eq(printers.daemonId, daemonId), isNull(printers.disabledAt)));
    const active = rows.length
      ? await this.db
          .select({ id: printJobs.id, printerId: printJobs.printerId })
          .from(printJobs)
          .where(
            and(
              inArray(
                printJobs.printerId,
                rows.map((r) => r.p.id),
              ),
              ne(printJobs.phase, "ENDED"),
            ),
          )
      : [];
    return rows.map(({ p, runSeq }) => ({
      printerId: p.id,
      brand: p.brand,
      serial: p.serial,
      host: p.host,
      accessCodeCipher: p.accessCodeCipher ?? "",
      keyFingerprint: p.accessCodeKeyFingerprint ?? "",
      currentJobRef: active.find((j) => j.printerId === p.id)?.id ?? null,
      cleanupJobRefs: [],
      ...(runSeq ? { knownRunSeq: runSeq } : {}),
    }));
  }

  /* ───────── messages ───────── */

  private async handle(conn: Conn, m: DaemonMessage) {
    conn.lastHeard = Date.now();
    switch (m.type) {
      case "ping":
        conn.send("pong", {});
        return;
      case "pong":
      case "ack":
        return;
      case "printer.snapshot":
        await this.facts.snapshot(conn.daemonId, m.body);
        return;
      case "printer.event":
      case "command.result":
      case "discovery.report": {
        /* Sent again after a reconnect until acknowledged: applied the first time only. */
        const [seen] = await this.db.select({ id: daemonInbox.messageId }).from(daemonInbox).where(eq(daemonInbox.messageId, m.id));
        if (!seen) {
          if (m.type === "printer.event") await this.facts.event(conn.daemonId, m.body);
          else if (m.type === "command.result") await this.facts.commandResult(conn.daemonId, m.body);
          await this.db.insert(daemonInbox).values({ messageId: m.id, daemonId: conn.daemonId }).onConflictDoNothing();
        }
        if (needsAck(m.type)) conn.send("ack", { id: m.id });
        return;
      }
      default:
        return;
    }
  }

  /* ───────── sending ───────── */

  private async afterCommit(u: Uow) {
    for (const daemonId of u.assignments) this.hub.get(daemonId)?.send("printers.assign", { printers: await this.assigned(daemonId) });
    if (!u.commands.size) return;
    const rows = await this.db
      .select({ daemonId: daemonCommands.daemonId })
      .from(daemonCommands)
      .where(and(inArray(daemonCommands.id, [...u.commands]), eq(daemonCommands.status, "QUEUED")));
    for (const daemonId of new Set(rows.map((r) => r.daemonId))) await this.deliver(daemonId);
  }

  /**
   * Sends a daemon every command it has not answered, oldest first. After a reconnect that includes
   * ones already sent: the same command id again is a redelivery, which the daemon carries out at
   * most once.
   */
  private async deliver(daemonId: string) {
    const link = this.hub.get(daemonId);
    if (!link) return;
    const rows = await this.db
      .select()
      .from(daemonCommands)
      .where(and(eq(daemonCommands.daemonId, daemonId), inArray(daemonCommands.status, ["QUEUED", "SENT"])))
      .orderBy(daemonCommands.id);
    for (const c of rows) {
      if (!link.send("command", { commandId: c.id, printerId: c.printerId, kind: c.kind, expiresAt: c.expiresAt.toISOString(), params: c.payload }, c.id)) return;
      if (c.status === "QUEUED") await this.db.update(daemonCommands).set({ status: "SENT" }).where(and(eq(daemonCommands.id, c.id), eq(daemonCommands.status, "QUEUED")));
    }
  }

  /* ───────── housekeeping ───────── */

  private async tick() {
    const silentFor = this.config.daemonHeartbeatSeconds * 3 * 1000;
    for (const c of this.conns) {
      /* Three heartbeats missed: the daemon is gone, whatever the socket says. */
      if (Date.now() - c.lastHeard > silentFor) c.ws.terminate();
    }
    /* A command that could never be handed over (its daemon went away first) is over once its time is up; the daemon answers for the ones it did receive. */
    const stale = await this.db
      .select({ id: daemonCommands.id, daemonId: daemonCommands.daemonId })
      .from(daemonCommands)
      .where(and(eq(daemonCommands.status, "QUEUED"), lt(daemonCommands.expiresAt, new Date())));
    for (const c of stale) await this.facts.commandResult(c.daemonId, { commandId: c.id, status: "expired", code: "expired", message: "never delivered" });
  }
}
