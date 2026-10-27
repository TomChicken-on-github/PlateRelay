import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { OrderPreview, OverviewStats } from "@platerelay/shared";
import { eq } from "drizzle-orm";
import { printers } from "../src/db/schema.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { SchedulerService } from "../src/printers/scheduler.service.js";
import { JPEG, startApp, type TestApp, x2dTwoPlates } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

describe("submit page API", () => {
  let t: TestApp;
  let user: Agent, other: Agent, staff: Agent, builder: Agent;

  const preview = async (a: Agent) => (await a.post("/api/orders/preview").attach("file", x2dTwoPlates(), "猫耳外壳.gcode.3mf").expect(200)).body as OrderPreview;
  const submit = (a: Agent, plates?: unknown) => {
    const req = a.post("/api/orders").attach("file", x2dTwoPlates(), "猫耳外壳.gcode.3mf").field("answers", JSON.stringify({ reason: "比赛结构件" }));
    return plates === undefined ? req : req.field("plates", JSON.stringify(plates));
  };

  before(async () => {
    t = await startApp();
    ({ agent: user } = await t.as("user", "林小满"));
    ({ agent: other } = await t.as("user", "周浩然"));
    ({ agent: staff } = await t.as("staff", "陈一帆"));
    ({ agent: builder } = await t.as("builder", "赵乐"));
  });
  after(() => t.close());

  it("previews plates with fleet availability and stores nothing", async () => {
    let p = await preview(user);
    assert.equal(p.plates.length, 2);
    assert.ok(p.plates.every((x) => x.availability.state === "none"));
    assert.match(p.plates[0].thumbnailUrl ?? "", /^data:image\/png;base64,/);
    assert.deepEqual(p.queue, { length: 0, aheadSeconds: 0 });

    const res = await builder.post("/api/printers").send({ name: "X2D-01", ip: "192.0.2.10", serial: "SNX2D010001" }).expect(201);
    await t.db.update(printers).set({ openToContestants: true, model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }] }).where(eq(printers.id, res.body.id));
    p = await preview(user);
    assert.ok(p.plates.every((x) => x.availability.state === "unavailable"), "compatible but offline");

    await t.db.update(printers).set({ state: "IDLE", storage: [{ medium: "internal", present: true, writable: true }] }).where(eq(printers.id, res.body.id));
    p = await preview(user);
    assert.ok(p.plates.every((x) => x.availability.state === "ok"));
    assert.equal((await user.get("/api/orders/mine").expect(200)).body.length, 0);
  });

  it("submits only the picked plates and keeps the file's plate count", async () => {
    const res = await submit(user, [2]).expect(201);
    assert.deepEqual(res.body.orders.map((o: { plate: { index: number; count: number } }) => [o.plate.index, o.plate.count]), [[2, 2]]);
    assert.equal((await submit(user, [3]).expect(400)).body.code, "invalid-plates");
    assert.equal((await submit(user, []).expect(400)).body.code, "invalid-plates");
    await submit(user, "1").expect(400);
  });

  it("counts the queue for 概况 and the preview", async () => {
    const [a, b] = (await submit(other).expect(201)).body.orders;
    await builder.post(`/api/orders/${a.id}/approve`).expect(200);
    const stats = (await user.get("/api/overview").expect(200)).body as OverviewStats;
    assert.deepEqual(stats, { pendingReview: 2, queued: 1, waitingCompatible: 0, todo: 1 }, "the idle X2D has a suggestion to confirm");
    const p = await preview(user);
    assert.equal(p.queue.length, 1);
    assert.equal(p.queue.aheadSeconds, a.printSeconds);
    await other.post(`/api/orders/${b.id}/cancel`).send({ reason: "测试" }).expect(200);
  });

  it("gives the 入库 photo to the owner and to staff who see any order", async () => {
    /* the order approved above is the queue head; print and store it */
    const [p] = await t.db.select().from(printers);
    t.commands.online = true;
    await t.app.get(SchedulerService).dispatch(p.id);
    t.commands.online = false;
    const id = (await t.db.select().from(printers).where(eq(printers.id, p.id)))[0].currentOrderId!;
    assert.equal((await other.get(`/api/orders/${id}`).expect(200)).body.storePhotoUrl, null, "not stored yet");
    const svc = t.app.get(PrintersService);
    await svc.onStarted(p.id);
    await svc.onFinished(p.id);
    await staff.post(`/api/orders/${id}/store`).field("slot", "A-1-1").field("bedCleared", "true").attach("photo", JPEG, "p.jpg").expect(200);
    assert.ok((await other.get(`/api/orders/${id}`).expect(200)).body.storePhotoUrl);
    assert.ok((await builder.get(`/api/orders/${id}`).expect(200)).body.storePhotoUrl);
    await user.get(`/api/orders/${id}`).expect(404);
  });
});
