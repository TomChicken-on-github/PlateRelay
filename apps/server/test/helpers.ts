import "reflect-metadata";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RoleId } from "@platerelay/shared";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { strToU8, zipSync } from "fflate";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { SYSTEM } from "../src/auth/actor.js";
import { AuthService } from "../src/auth/auth.service.js";
import { DB, type Db, openDb } from "../src/db/db.js";
import { configureApp } from "../src/main.js";
import { type JobCommand, PRINTER_COMMANDS, type PrinterCommands, PrinterUnreachable } from "../src/printers/commands.js";

const FIX = join(__dirname, "../../../../packages/shared/test/fixtures/x2d-two-plates");
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

/** The two-plate X2D fixture as a .gcode.3mf: real slicer metadata, stand-in G-code and PNG. */
export function x2dTwoPlates(): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const f of ["slice_info.config", "model_settings.config", "project_settings.config"]) files[`Metadata/${f}`] = readFileSync(join(FIX, f));
  for (const n of [1, 2]) {
    files[`Metadata/plate_${n}.gcode`] = strToU8("G28\n");
    files[`Metadata/plate_${n}.png`] = PNG;
  }
  return Buffer.from(zipSync(files));
}

/** Records commands instead of talking to a daemon. Printers are unreachable (nothing dispatches) until `online` is set. */
export class FakeCommands implements PrinterCommands {
  sent: { printerId: string; cmd: string; arg?: unknown }[] = [];
  online = false;
  reachable() {
    return this.online;
  }
  async startJob(printerId: string, job: JobCommand) {
    if (!this.online) throw new PrinterUnreachable(printerId);
    this.sent.push({ printerId, cmd: "start", arg: job });
  }
  async resolveError(printerId: string, action: string) {
    if (!this.online) throw new PrinterUnreachable(printerId);
    this.sent.push({ printerId, cmd: "resolve", arg: action });
  }
  async stop(printerId: string) {
    if (!this.online) throw new PrinterUnreachable(printerId);
    this.sent.push({ printerId, cmd: "stop" });
  }
}

export interface TestApp {
  app: NestExpressApplication;
  db: Db;
  commands: FakeCommands;
  /** Signed-in supertest agent for a new account with the role. */
  as(role: RoleId, name?: string): Promise<{ agent: ReturnType<typeof request.agent>; id: string }>;
  close(): Promise<void>;
}

let n = 0;

export async function startApp(): Promise<TestApp> {
  const dataDir = await mkdtemp(join(tmpdir(), "platerelay-test-"));
  /* PLATERELAY_TEST_DATABASE_URL runs the suite against a real, empty PostgreSQL database instead of in-memory PGlite. */
  const handle = await openDb(process.env.PLATERELAY_TEST_DATABASE_URL || "memory");
  const commands = new FakeCommands();
  const mod = await Test.createTestingModule({
    imports: [AppModule.forRoot({ databaseUrl: null, dataDir, secret: Buffer.from("test-secret"), secureCookies: false, storage: { kind: "local" } }, handle)],
  })
    .overrideProvider(PRINTER_COMMANDS)
    .useValue(commands)
    .compile();
  mod.useLogger(false);
  const app = configureApp(mod.createNestApplication<NestExpressApplication>());
  await app.init();
  const auth = app.get(AuthService);
  return {
    app,
    db: app.get(DB),
    commands,
    async as(role, name) {
      const username = `${role}${++n}`;
      const id = await auth.createUser(SYSTEM, { username, displayName: name ?? username, password: "password1", role });
      const agent = request.agent(app.getHttpServer());
      await agent.post("/api/auth/login").send({ username, password: "password1" }).expect(200);
      return { agent, id };
    },
    async close() {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}
