import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import type { Ctx } from "../src/auth/actor.js";
import { orders, printers } from "../src/db/schema.js";
import { OrdersService } from "../src/orders/orders.service.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { SchedulerService } from "../src/printers/scheduler.service.js";
import { startApp, type TestApp, x2dTwoPlates } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];
const databaseUrl = process.env.PLATERELAY_TEST_DATABASE_URL;

describe("skip-parts concurrency (PostgreSQL)", { skip: !databaseUrl && "requires PostgreSQL to exercise concurrent transactions" }, () => {
  let t: TestApp;
  let user: Agent;
  let builder: Agent;
  let orderId: number;
  let printerId: string;

  before(async () => {
    t = await startApp();
    ({ agent: user } = await t.as("user"));
    ({ agent: builder } = await t.as("builder"));
    const printer = await builder.post("/api/printers").send({ name: "Skip-Race-X2D", ip: "192.0.2.40", serial: "SKIPRACEX2D01" }).expect(201);
    printerId = printer.body.id;
    await t.db.update(printers).set({ openToContestants: true, model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "IDLE" }).where(eq(printers.id, printerId));
    const submitted = await user.post("/api/orders").attach("file", x2dTwoPlates(), "race.gcode.3mf").field("answers", JSON.stringify({ reason: "test" })).field("plates", "[1]").expect(201);
    orderId = submitted.body.orders[0].id as number;
    await builder.post(`/api/orders/${orderId}/approve`).expect(200);
    t.commands.online = true;
    assert.equal(await t.app.get(SchedulerService).dispatch(printerId), orderId);
    t.commands.online = false;
    await t.app.get(PrintersService).onStarted(printerId);
  });

  after(async () => {
    if (!t) return;
    await t.close();
  });

  it("serializes competing skips so the last part can never be skipped", { timeout: 15_000 }, async () => {
    const commandsEntered = new EventEmitter();
    const releaseCommand = new EventEmitter();
    let commands = 0;
    const originalCommand = t.commands.skipParts;
    t.commands.skipParts = async () => {
      commands++;
      const released = once(releaseCommand, "release", { signal: AbortSignal.timeout(10_000) });
      commandsEntered.emit("entered");
      await released;
    };

    const service = t.app.get(OrdersService);
    const originalService = service.skipParts;
    const secondStarted = new EventEmitter();
    service.skipParts = async (ctx: Ctx, id: number, parts: number[]) => {
      if (ctx.device === "skip-race-second") secondStarted.emit("started");
      return originalService.call(service, ctx, id, parts);
    };

    let results;
    try {
      const entered = once(commandsEntered, "entered", { signal: AbortSignal.timeout(10_000) });
      const first = user.post(`/api/orders/${orderId}/skip-parts`).send({ parts: [253, 264, 275, 308] }).then((response) => response);
      await entered;
      const started = once(secondStarted, "started", { signal: AbortSignal.timeout(10_000) });
      const second = user.post(`/api/orders/${orderId}/skip-parts`).set("User-Agent", "skip-race-second").send({ parts: [319, 330, 341, 396, 407] }).then((response) => response);
      await started;
      releaseCommand.emit("release");
      results = await Promise.all([first, second]);
    } finally {
      releaseCommand.emit("release");
      service.skipParts = originalService;
      t.commands.skipParts = originalCommand;
    }

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409)?.body.code, "skip-all");
    assert.equal(commands, 1, "the competing request must fail before a second device command");
    const [saved] = await t.db.select({ skipped: orders.skippedParts }).from(orders).where(eq(orders.id, orderId));
    assert.equal(saved.skipped.length, 4);

    await builder.post(`/api/orders/${orderId}/cancel`).send({ reason: "concurrency test cleanup" }).expect(200);
    const { agent: staff } = await t.as("staff");
    await staff.post(`/api/printers/${printerId}/clear-bed`).expect(200);
  });
});
