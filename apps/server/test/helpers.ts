import "reflect-metadata";
import { constants, generateKeyPairSync, type KeyObject, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import type { Role } from "@platerelay/shared";
import { strToU8, zipSync } from "fflate";
import request from "supertest";
import { WebSocket } from "ws";
import { AppModule } from "../src/app.module.js";
import { AuthService } from "../src/auth/auth.service.js";
import { SYSTEM } from "../src/common/ctx.js";
import { DB, type Db, openDb } from "../src/db/db.js";
import { configureApp } from "../src/main.js";

const FIX = join(__dirname, "../../../../packages/shared/test/fixtures/x2d-two-plates");
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
export const DEV_ENROLL_TOKEN = "test-enroll-token";

/**
 * The two-plate X2D fixture as a .gcode.3mf: real slicer metadata, stand-in G-code and PNG. `edit`
 * rewrites slice_info.config to make other versions (another print time, another model).
 */
export function x2dTwoPlates(edit?: (sliceInfo: string) => string): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const f of ["slice_info.config", "model_settings.config", "project_settings.config"]) files[`Metadata/${f}`] = readFileSync(join(FIX, f));
  if (edit) files["Metadata/slice_info.config"] = strToU8(edit(readFileSync(join(FIX, "slice_info.config"), "utf8")));
  for (const n of [1, 2]) {
    files[`Metadata/plate_${n}.gcode`] = strToU8("G28\n");
    files[`Metadata/plate_${n}.png`] = PNG;
    files[`Metadata/top_${n}.png`] = PNG;
    files[`Metadata/pick_${n}.png`] = PNG;
  }
  return Buffer.from(zipSync(files));
}

/** Plate 1 of the fixture prints for this long (slicer prediction). */
export const PLATE1_SECONDS = 16479;
export const x2dPlate1Plus = (minutes: number) => x2dTwoPlates((x) => x.replace(`key="prediction" value="${PLATE1_SECONDS}"`, `key="prediction" value="${PLATE1_SECONDS + minutes * 60}"`));

type Agent = ReturnType<typeof request.agent>;

/** A signed-in browser. Writes get the Idempotency-Key every write needs. */
export class Client {
  constructor(
    readonly agent: Agent,
    readonly id: string,
  ) {}
  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }
  post(path: string, body?: object) {
    const r = this.agent.post(`/api/v1${path}`).set("Idempotency-Key", randomUUID());
    return body === undefined ? r : r.send(body);
  }
  put(path: string, body: object) {
    return this.agent.put(`/api/v1${path}`).set("Idempotency-Key", randomUUID()).send(body);
  }
  patch(path: string, body: object) {
    return this.agent.patch(`/api/v1${path}`).set("Idempotency-Key", randomUUID()).send(body);
  }
  delete(path: string) {
    return this.agent.delete(`/api/v1${path}`).set("Idempotency-Key", randomUUID());
  }
}

export interface TestApp {
  app: NestExpressApplication;
  db: Db;
  port: number;
  origin: string;
  /** A new account with the role, signed in. */
  as(role: Role, name?: string): Promise<Client>;
  close(): Promise<void>;
}

let n = 0;

export async function startApp(): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), "platerelay-test-"));
  /* PLATERELAY_TEST_DATABASE_URL runs the suite against a real, empty PostgreSQL database instead of in-memory PGlite. */
  const handle = await openDb(process.env.PLATERELAY_TEST_DATABASE_URL || "memory");
  const config = { databaseUrl: null, dataDir, secret: Buffer.from("test-secret"), secureCookies: false, storage: { kind: "local" as const }, publicOrigin: "http://panel.test", daemonHeartbeatSeconds: 15, devEnrollToken: DEV_ENROLL_TOKEN };
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot(config, handle)] }).compile();
  if (!process.env.PLATERELAY_TEST_LOG) mod.useLogger(false);
  const app = configureApp(mod.createNestApplication<NestExpressApplication>());
  await app.listen(0, "127.0.0.1");
  const port = (app.getHttpServer().address() as AddressInfo).port;
  const auth = app.get(AuthService);
  return {
    app,
    db: app.get(DB),
    port,
    origin: config.publicOrigin,
    async as(role, name) {
      const username = `${role.toLowerCase()}${++n}`;
      const user = await auth.createUser(SYSTEM, { username, displayName: name ?? username, password: "password1", role });
      const agent = request.agent(app.getHttpServer());
      await agent.post("/api/v1/auth/login").send({ username, password: "password1" }).expect(200);
      return new Client(agent, user.id);
    },
    async close() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

export const until = async (what: string, ok: () => unknown | Promise<unknown>, ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await ok();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

interface Frame {
  id: string;
  type: string;
  body: Record<string, unknown>;
}

/**
 * A daemon as the panel sees it: enrolls with its own key, signs the challenge, then says whatever
 * the test tells it to. It keeps what the panel sent so tests can look at the commands.
 */
export class FakeDaemon {
  readonly bootId = randomUUID();
  readonly received: Frame[] = [];
  daemonId = "";
  httpToken = "";
  closeCode: number | null = null;
  private seq = 0;
  private ws!: WebSocket;
  private readonly privateKey: KeyObject;
  readonly publicKey: string;

  constructor(private readonly t: TestApp) {
    const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  }

  async enroll(name = "bench") {
    const res = await request(this.t.app.getHttpServer()).post("/daemon/v1/enroll").send({ token: DEV_ENROLL_TOKEN, publicKey: this.publicKey, name, platform: "test", daemonVersion: "0.0.0", protocolVersion: "1.0" }).expect(200);
    this.daemonId = res.body.daemonId;
    return this;
  }

  async connect(opts: { origin?: string } = {}) {
    this.closeCode = null;
    this.received.length = 0;
    this.ws = new WebSocket(`ws://127.0.0.1:${this.t.port}/daemon/v1/ws`);
    this.ws.on("close", (code) => (this.closeCode = code));
    this.ws.on("message", (data) => {
      const f = JSON.parse(String(data)) as Frame;
      this.received.push(f);
      if (f.type === "command") this.raw("ack", { id: f.id });
    });
    await new Promise((ok, fail) => this.ws.once("open", ok).once("error", fail));
    this.raw("hello", { daemonId: this.daemonId, protocolVersion: "1.0", daemonVersion: "0.0.0", platform: "test", bootId: this.bootId, adapters: [{ brand: "sim", version: "0" }] });
    const challenge = (await until("challenge", () => this.received.find((f) => f.type === "challenge") ?? this.closeCode)) as Frame | number;
    if (typeof challenge === "number") return this;
    const signature = sign("sha256", Buffer.from(`platerelay-daemon-auth/v1\n${this.daemonId}\n${challenge.body.nonce}\n${opts.origin ?? this.t.origin}`), { key: this.privateKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 }).toString("base64");
    this.raw("auth", { signature });
    const welcome = (await until("welcome", () => this.received.find((f) => f.type === "welcome") ?? this.closeCode)) as Frame | number;
    if (typeof welcome !== "number") this.httpToken = String(welcome.body.httpToken);
    return this;
  }

  private raw(type: string, body: object, id: string = randomUUID()) {
    this.ws.send(JSON.stringify({ id, type, ts: new Date().toISOString(), body }));
    return id;
  }

  /** Sends a message that wants an acknowledgement and waits for it, so the panel has applied it when this returns. */
  private async acked(type: string, body: object) {
    const id = this.raw(type, body);
    await until(`ack of ${type}`, () => this.received.some((f) => f.type === "ack" && f.body.id === id));
  }

  /** A full status report. Reports are not acknowledged, so this waits for a pong sent after it instead. */
  async snapshot(printerId: string, s: Record<string, unknown>) {
    this.raw("printer.snapshot", { printerId, bootId: this.bootId, seq: ++this.seq, connected: true, runSeq: 0, ...s });
    const before = this.received.filter((f) => f.type === "pong").length;
    this.raw("ping", {});
    await until("pong", () => this.received.filter((f) => f.type === "pong").length > before);
  }

  event(printerId: string, kind: string, extra: { jobRef?: string; data?: object } = {}) {
    return this.acked("printer.event", { printerId, bootId: this.bootId, seq: ++this.seq, kind, ...(extra.jobRef ? { jobRef: extra.jobRef } : {}), data: extra.data ?? {} });
  }

  result(commandId: string, status: string, extra: { code?: string; message?: string; data?: object } = {}) {
    return this.acked("command.result", { commandId, status, ...extra });
  }

  commands(kind?: string) {
    return this.received.filter((f) => f.type === "command" && (!kind || f.body.kind === kind)).map((f) => f.body as { commandId: string; printerId: string; kind: string; params: Record<string, unknown> });
  }

  /** The nth command of a kind the panel sent (from 0), waiting for it if it is not there yet. */
  async command(kind: string, nth = 0) {
    return (await until(`${kind} command #${nth}`, () => this.commands(kind)[nth])) as ReturnType<FakeDaemon["commands"]>[number];
  }

  async close() {
    if (this.ws.readyState === this.ws.CLOSED) return;
    this.ws.close();
    await until("socket closed", () => this.closeCode !== null);
  }
}

/** An idle simulated dual-nozzle printer with two loaded trays that match the fixture's plate 1 closely enough to print it. */
export const IDLE = {
  state: "IDLE",
  modelId: "N6",
  modelName: "X2D",
  nozzles: [
    { extruder: 1, diameterMm: 0.4, flow: "standard" },
    { extruder: 2, diameterMm: 0.4, flow: "standard" },
  ],
};
