import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { DEFAULT_QUEUE_RULES, type DispatchOptionsView, type OrderDetail, type OrderPreview, type OrderView, type QueueRules, type ResourcesView, type TodoView } from "@platerelay/shared";
import { desc, eq, inArray, ne } from "drizzle-orm";
import { auditLog, orders, printers, settings } from "../src/db/schema.js";
import { SchedulerService } from "../src/printers/scheduler.service.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { PLATE1_SECONDS, startApp, type TestApp, x2dPlate1Plus, x2dTwoPlates } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

const P2S = (x: string) => x.replaceAll('printer_model_id" value="N6"', 'printer_model_id" value="N7"');
/** The same plates sliced for a single-nozzle N7: one nozzle, no sides. */
const singleN7 = (x: string) => P2S(x).replaceAll('value="0.4,0.4"', 'value="0.4"').replaceAll(/\s*<nozzle id="1" extruder_id="2"[^>]*\/>/g, "");

describe("print rules", () => {
  let t: TestApp;
  let user: Agent, other: Agent, staff: Agent, builder: Agent;
  let x2d: string;

  const submit = (a: Agent, file = x2dTwoPlates(), fields: Record<string, string> = {}) => {
    const req = a.post("/api/orders").attach("file", file, "猫耳外壳.gcode.3mf").field("answers", JSON.stringify({ reason: "比赛结构件" })).field("plates", "[1]");
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req;
  };
  const revise = (a: Agent, id: number, file: Buffer) => a.post(`/api/orders/${id}/revise`).attach("file", file, "猫耳外壳-v2.gcode.3mf");
  const queued = async (a: Agent) => {
    const id = (await submit(a).expect(201)).body.orders[0].id as number;
    await builder.post(`/api/orders/${id}/approve`).expect(200);
    return id;
  };
  const positions = async () => {
    const mine = [...(await user.get("/api/orders/mine").expect(200)).body, ...(await other.get("/api/orders/mine").expect(200)).body] as OrderView[];
    return new Map(mine.filter((o) => o.queue).map((o) => [o.id, o.queue!.position]));
  };
  const setRules = (patch: (r: QueueRules) => void) => {
    const r = structuredClone(DEFAULT_QUEUE_RULES);
    patch(r);
    return builder.put("/api/settings/rules").send(r).expect(204);
  };

  async function addPrinter(name: string, modelId: string, nozzles = [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }]) {
    const res = await builder.post("/api/printers").send({ name, ip: "192.0.2.20", serial: `SN${name.replace(/\W/g, "")}0001` }).expect(201);
    await t.db
      .update(printers)
      .set({ model: modelId === "N6" ? "Bambu Lab X2D" : "Bambu Lab P2S", modelId, nozzles, storage: [{ medium: "internal", present: true, writable: true }], state: "MAINTENANCE" })
      .where(eq(printers.id, res.body.id));
    return res.body.id as string;
  }

  before(async () => {
    t = await startApp();
    ({ agent: user } = await t.as("user", "林小满"));
    ({ agent: other } = await t.as("user", "周浩然"));
    ({ agent: staff } = await t.as("staff", "陈一帆"));
    ({ agent: builder } = await t.as("builder", "赵乐"));
    x2d = await addPrinter("X2D-01", "N6");
  });
  after(() => t.close());

  /* each test starts from an empty queue and the default rules */
  beforeEach(async () => {
    await t.db.update(orders).set({ status: "CANCELLED", queueSeq: null }).where(ne(orders.status, "CANCELLED"));
    await t.db.update(printers).set({ state: "MAINTENANCE", currentOrderId: null });
    await t.db.delete(settings).where(inArray(settings.key, ["queue.rules", "resources"]));
    t.commands.online = false;
  });

  describe("开放给选手 and 本场可用资源", () => {
    it("starts new printers closed, blocks plates nothing open can print, opens with an audit entry", async () => {
      const [p] = await t.db.select().from(printers).where(eq(printers.id, x2d));
      assert.equal(p.openToContestants, false);
      const pv = (await user.post("/api/orders/preview").attach("file", x2dTwoPlates(), "a.gcode.3mf").expect(200)).body as OrderPreview;
      assert.deepEqual(pv.plates[0].check.block, ["本场没有开放 X2D"]);
      const res = await submit(user).expect(422);
      assert.equal(res.body.code, "plate-blocked");

      await user.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(403);
      const v = await builder.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(200);
      assert.equal(v.body.openToContestants, true);
      const [entry] = await t.db.select().from(auditLog).where(eq(auditLog.action, "printer.open"));
      assert.deepEqual(entry.after, { open: true });
      await submit(user).expect(201);
    });

    it("lists only open printers, with the wait as a range and hidden rows only for configurers", async () => {
      await addPrinter("P2S-01", "N7", [{ extruder: 1, diameter: 0.4 }]);
      let r = (await user.get("/api/resources").expect(200)).body as ResourcesView;
      assert.deepEqual(r.models.map((m) => m.modelId), ["N6"]);
      assert.equal(r.models[0].wait, "gt4h", "no printer up, so the wait is open-ended");
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, x2d));
      r = (await user.get("/api/resources").expect(200)).body;
      assert.equal(r.models[0].wait, "lt30m");
      assert.equal(r.models[0].idle, 1);

      const cfg = (await builder.get("/api/settings/resources").expect(200)).body;
      await user.get("/api/settings/resources").expect(403);
      await builder.put("/api/settings/resources").send({ ...cfg, showWait: false, models: { N6: { note: "只有 0.4 喷嘴", wait: "1h-2h" } } }).expect(204);
      r = (await user.get("/api/resources").expect(200)).body;
      assert.equal(r.models[0].wait, null);
      assert.equal(r.models[0].note, "只有 0.4 喷嘴");
      const b = (await builder.get("/api/resources").expect(200)).body as ResourcesView;
      assert.equal(b.models[0].wait, "1h-2h");
      assert.equal(b.models[0].waitManual, true);

      await builder.put("/api/settings/resources").send({ ...cfg, models: { N6: { hidden: true } } }).expect(204);
      assert.equal(((await user.get("/api/resources").expect(200)).body as ResourcesView).models.length, 0);
      assert.equal((await submit(user).expect(422)).body.code, "plate-blocked");
    });

    it("checks materials once spools are known; a missing colour warns unless set to block", async () => {
      await t.db.update(printers).set({ trays: [{ slot: "AMS 1 · 1", type: "PLA", color: "#FFFF00FF" }] }).where(eq(printers.id, x2d));
      let pv = (await user.post("/api/orders/preview").attach("file", x2dTwoPlates(), "a.gcode.3mf").expect(200)).body as OrderPreview;
      assert.deepEqual(pv.plates[0].check.block, ["本场的 X2D 没有 PETG"]);

      const cfg = (await builder.get("/api/settings/resources").expect(200)).body;
      const stock = [{ id: "s1", type: "PETG", color: "#000000", name: "黑", modelIds: ["N6"] }];
      await builder.put("/api/settings/resources").send({ ...cfg, stock }).expect(204);
      pv = (await user.post("/api/orders/preview").attach("file", x2dTwoPlates(), "a.gcode.3mf").expect(200)).body;
      assert.deepEqual(pv.plates[0].check, { block: [], missingColours: ["#ffffff"] });
      const r = (await user.get("/api/resources").expect(200)).body as ResourcesView;
      assert.deepEqual(
        r.materials.map((m) => [m.type, m.colors.map((c) => [c.color, c.stock])]),
        [["PLA", [["#ffff00", false]]], ["PETG", [["#000000", true]]]],
      );

      const ok = (await submit(user, x2dTwoPlates(), { colour: "exact" }).expect(201)).body.orders[0];
      assert.equal(ok.colourPref, "exact");
      const pool = (await builder.get("/api/review").expect(200)).body as OrderDetail[];
      assert.deepEqual(pool.find((o) => o.id === ok.id)!.missingColours, ["#ffffff"]);

      await builder.put("/api/settings/resources").send({ ...cfg, stock, colourMissing: "block" }).expect(204);
      assert.equal((await submit(user, x2dTwoPlates(), { colour: "exact" }).expect(422)).body.code, "plate-blocked");
      await submit(user, x2dTwoPlates(), { colour: "similar" }).expect(201);
      await t.db.update(printers).set({ trays: null }).where(eq(printers.id, x2d));
    });

    it("takes a build plate only when 自选板 is allowed", async () => {
      assert.equal((await submit(user, x2dTwoPlates(), { bedType: "Cool Plate" }).expect(400)).body.code, "plate-choice-disabled");
      await submit(user, x2dTwoPlates(), { bedType: "Glass" }).expect(400);
      await setRules((r) => (r.allowPlateChoice = true));
      const o = (await submit(user, x2dTwoPlates(), { bedType: "Cool Plate" }).expect(201)).body.orders[0];
      assert.equal(o.bedType, "Cool Plate");
      assert.equal(o.colourPref, "similar", "颜色要求 defaults to 相近");
    });

  });

  describe("建议派单", () => {
    const todo = async () => (await staff.get("/api/todo").expect(200)).body as TodoView;
    const status = async (id: number) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0].status;

    it("only suggests; nothing is sent until Staff confirm, and closed printers get no suggestion", async () => {
      const id = await queued(user);
      await builder.post(`/api/printers/${x2d}/open`).send({ open: false }).expect(200);
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, x2d));
      t.commands.online = true;
      assert.equal((await todo()).dispatch.length, 0);
      await builder.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(200);
      const items = (await todo()).dispatch;
      assert.deepEqual(items.map((d) => [d.printer.id, d.order.id]), [[x2d, id]]);
      assert.equal(((await staff.get(`/api/printers/${x2d}`).expect(200)).body as { suggestion: OrderView | null }).suggestion?.id, id);
      assert.equal(((await user.get(`/api/printers/${x2d}`).expect(200)).body as { suggestion: OrderView | null }).suggestion, null, "submitters do not see it");
      assert.equal(await status(id), "QUEUED");
      assert.equal(t.commands.sent.filter((c) => c.cmd === "start").length, 0);
    });

    it("sends the suggestion by default, or any other order the printer can take", async () => {
      const a = await queued(user);
      const b = await queued(other);
      const c = await queued(other);
      await other.post(`/api/orders/${c}/cancel`).send({ reason: "不需要了" }).expect(200);
      await builder.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(200);
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, x2d));
      await user.get(`/api/printers/${x2d}/dispatch-options`).expect(403);
      const opts = (await staff.get(`/api/printers/${x2d}/dispatch-options`).expect(200)).body as DispatchOptionsView;
      assert.equal(opts.suggestedOrderId, a);
      assert.deepEqual(opts.orders.map((o) => o.id), [a, b]);
      await user.post(`/api/printers/${x2d}/dispatch`).send({ orderId: b }).expect(403);
      assert.equal((await staff.post(`/api/printers/${x2d}/dispatch`).send({ orderId: b }).expect(409)).body.code, "printer-unreachable");
      assert.equal(await status(b), "QUEUED");
      t.commands.online = true;
      assert.equal((await staff.post(`/api/printers/${x2d}/dispatch`).send({ orderId: c }).expect(409)).body.code, "order-not-dispatchable");
      const sent = t.commands.sent.length;
      const v = await staff.post(`/api/printers/${x2d}/dispatch`).send({ orderId: b }).expect(200);
      assert.equal(v.body.state, "PREPARING");
      assert.equal(await status(b), "PRINTING");
      assert.equal(await status(a), "QUEUED");
      assert.ok((await t.db.select().from(orders).where(eq(orders.id, a)))[0].skippedSince, "the suggestion Staff passed over counts as skipped");
      assert.deepEqual(t.commands.sent.slice(sent).map((c) => c.cmd), ["start"]);
      const [log] = await t.db.select().from(auditLog).where(eq(auditLog.action, "order.dispatch")).orderBy(desc(auditLog.at)).limit(1);
      assert.equal(log.targetId, String(b));
      assert.equal(log.actorType, "user");
      assert.equal((await staff.post(`/api/printers/${x2d}/dispatch`).send({ orderId: a }).expect(409)).body.code, "printer-not-ready");
    });

    it("suggests different orders to different idle printers", async () => {
      const x2d2 = await addPrinter("X2D-02", "N6");
      await t.db.update(printers).set({ openToContestants: true }).where(eq(printers.id, x2d2));
      await builder.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(200);
      const a = await queued(user);
      const b = await queued(other);
      await t.db.update(printers).set({ state: "IDLE", stateSince: new Date(Date.now() - 60e3) }).where(eq(printers.id, x2d2));
      await t.db.update(printers).set({ state: "IDLE", stateSince: new Date() }).where(eq(printers.id, x2d));
      const items = (await todo()).dispatch;
      assert.deepEqual(items.map((d) => [d.printer.id, d.order.id]), [[x2d2, a], [x2d, b]], "the printer idle longest takes the head");
      t.commands.online = true;
      await staff.post(`/api/printers/${x2d}/dispatch`).send({ orderId: b }).expect(200);
      assert.equal((await t.db.select().from(orders).where(eq(orders.id, a)))[0].skippedSince, null, "the head is waiting for X2D-02's confirmation, not passed over");
      await t.db.update(printers).set({ openToContestants: false }).where(eq(printers.id, x2d2));
    });
  });

  describe("修改文件", () => {
    it("a revision brings its own parts for 跳过零件, and withdrawing it brings the old ones back", async () => {
      const a = await queued(user);
      const row = async () => (await t.db.select().from(orders).where(eq(orders.id, a)))[0];
      const before = await row();
      assert.equal(before.parts.length, 9);
      const fewer = x2dTwoPlates((s) => s.replace(/\s*<object identify_id="407"[^>]*\/>/, ""));
      await revise(user, a, fewer).expect(200);
      const revised = await row();
      assert.equal(revised.parts.length, 8);
      assert.ok(!revised.parts.some((p) => p.id === 407));
      assert.ok(revised.partsTopKey && revised.partsTopKey !== before.partsTopKey, "the new file's plate images");
      await user.post(`/api/orders/${a}/withdraw`).expect(200);
      const back = await row();
      assert.equal(back.parts.length, 9);
      assert.equal(back.partsTopKey, before.partsTopKey);
      assert.equal(back.partsPickKey, before.partsPickKey);
    });

    it("re-reviews a revision frozen in place, reviews it first, then moves it back by the time rule", async () => {
      const a = await queued(user);
      const b = await queued(other);
      const c = await queued(other);
      const fresh = (await submit(other).expect(201)).body.orders[0].id as number;

      const v = (await revise(user, a, x2dPlate1Plus(20)).expect(200)).body as OrderView;
      assert.equal(v.status, "PENDING_REVIEW");
      assert.equal(v.printSeconds, PLATE1_SECONDS + 1200);
      assert.equal(v.revision!.kind, "revision");
      assert.equal(v.revision!.deltaSeconds, 1200);
      assert.equal(v.revision!.placesBack, 1);
      assert.equal(v.revision!.prev.printSeconds, PLATE1_SECONDS);
      assert.deepEqual(v.revisions, { count: 1, max: 3, switches: 0, maxSwitches: 1, baselineSeconds: PLATE1_SECONDS });
      assert.equal((await positions()).get(a), 1, "frozen in its place");

      const pool = (await builder.get("/api/review").expect(200)).body as OrderDetail[];
      assert.deepEqual(pool.slice(0, 2).map((o) => o.id), [a, fresh], "revisions first");
      await revise(other, a, x2dPlate1Plus(20)).expect(404);

      await builder.post(`/api/orders/${a}/approve`).expect(200);
      let pos = await positions();
      assert.deepEqual([pos.get(b), pos.get(a), pos.get(c)], [1, 2, 3]);
      const [penalty] = await t.db.select().from(auditLog).where(eq(auditLog.action, "queue.revision-penalty"));
      assert.deepEqual([penalty.before, penalty.after], [{ position: 1 }, { position: 2 }]);
      assert.match(penalty.reason!, /"placesBack":1/);

      /* compared with the first version: +31 min → two places */
      await revise(user, a, x2dPlate1Plus(31)).expect(200);
      await builder.post(`/api/orders/${a}/approve`).expect(200);
      pos = await positions();
      assert.deepEqual([pos.get(b), pos.get(c), pos.get(a)], [1, 2, 3], "cannot go past the tail");

      /* shorter keeps the place */
      const kept = (await revise(user, a, x2dPlate1Plus(-10)).expect(200)).body as OrderView;
      assert.equal(kept.revision!.placesBack, 0);
      await builder.post(`/api/orders/${a}/approve`).expect(200);
      assert.equal((await positions()).get(a), 3);

      const over = await revise(user, a, x2dPlate1Plus(1)).expect(409);
      assert.equal(over.body.code, "revision-limit");
      const done = (await user.get(`/api/orders/${a}`).expect(200)).body as OrderView;
      assert.equal(done.canRevise, true, "a model switch is still possible");
    });

    it("keeps every version: withdraw is free, a rejected revision falls back, restore counts and needs no review", async () => {
      const a = await queued(user);
      const b = await queued(other);
      const detail = async (ag: Agent = user) => (await ag.get(`/api/orders/${a}`).expect(200)).body as OrderDetail;

      /* withdraw: back to version 1, same place, nothing counted */
      let v = (await revise(user, a, x2dPlate1Plus(40)).expect(200)).body as OrderView;
      assert.equal(v.canWithdraw, true);
      v = (await user.post(`/api/orders/${a}/withdraw`).expect(200)).body as OrderView;
      assert.equal(v.status, "QUEUED");
      assert.equal(v.printSeconds, PLATE1_SECONDS);
      assert.equal(v.revisions.count, 0);
      assert.equal((await positions()).get(a), 1);
      await user.post(`/api/orders/${a}/withdraw`).expect(409);
      await other.post(`/api/orders/${a}/withdraw`).expect(404);

      /* a second upload under review supersedes the first and gives its count back */
      await revise(user, a, x2dPlate1Plus(20)).expect(200);
      v = (await revise(user, a, x2dPlate1Plus(25)).expect(200)).body as OrderView;
      assert.equal(v.revisions.count, 1);
      assert.equal(v.revision!.prev.printSeconds, PLATE1_SECONDS, "compared with the approved version");

      /* reject: the order keeps queueing on version 1 */
      v = (await builder.post(`/api/orders/${a}/reject`).send({ reason: "支撑太多" }).expect(200)).body as OrderView;
      assert.equal(v.status, "QUEUED");
      assert.equal(v.printSeconds, PLATE1_SECONDS);
      assert.equal((await positions()).get(a), 1);
      let d = await detail();
      assert.deepEqual(
        d.versions!.map((x) => [x.n, x.state, x.current]),
        [[1, "approved", true], [2, "withdrawn", false], [3, "withdrawn", false], [4, "rejected", false]],
      );
      assert.equal(d.versions![3].reason, "支撑太多");
      assert.equal(d.versions![3].printSeconds, PLATE1_SECONDS + 1500);

      /* an approved revision, then restore version 1: counts, no review, moves by the time rule */
      await revise(user, a, x2dPlate1Plus(-20)).expect(200);
      await builder.post(`/api/orders/${a}/approve`).expect(200);
      await user.post(`/api/orders/${a}/versions/4/restore`).expect(409);
      await user.post(`/api/orders/${a}/versions/5/restore`).expect(409);
      v = (await user.post(`/api/orders/${a}/versions/1/restore`).expect(200)).body as OrderView;
      assert.equal(v.status, "QUEUED");
      assert.equal(v.printSeconds, PLATE1_SECONDS);
      assert.equal(v.revisions.count, 3);
      assert.deepEqual([(await positions()).get(a), (await positions()).get(b)], [1, 2]);
      d = await detail();
      assert.deepEqual(d.versions!.at(-1)!.kind, "restore");
      assert.deepEqual([d.versions!.at(-1)!.restoredFrom, d.versions!.at(-1)!.current, d.versions!.at(-1)!.state], [1, true, "approved"]);

      /* every version stays downloadable; reviewers too, and that read is audited */
      assert.match((await user.get(`/api/orders/${a}/versions/2/file`).expect(200)).body.url, /./);
      await other.get(`/api/orders/${a}/versions/2/file`).expect(404);
      await builder.get(`/api/orders/${a}/versions/4/file`).expect(200);
    });

    it("keeps the stored order right when several revisions freeze and unfreeze in any order", async () => {
      const [a, b, c, d, e] = [await queued(user), await queued(user), await queued(other), await queued(user), await queued(other)];
      const keys = async () => new Map((await t.db.select({ id: orders.id, seq: orders.queueSeq }).from(orders).where(inArray(orders.id, [a, b, c, d, e]))).map((o) => [o.id, o.seq!]));
      const order = async () => [...(await keys()).entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id);

      await revise(user, b, x2dPlate1Plus(20)).expect(200); // +20 min: one place back once approved
      await revise(user, d, x2dPlate1Plus(5)).expect(200); // keeps its place
      await revise(user, a, x2dPlate1Plus(40)).expect(200); // two places back
      assert.deepEqual(await order(), [a, b, c, d, e], "frozen orders keep their keys");
      assert.deepEqual([...(await positions()).entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id), [a, b, c, d, e]);

      /* unfreeze in a different order than they froze */
      await user.post(`/api/orders/${d}/withdraw`).expect(200);
      await builder.post(`/api/orders/${b}/approve`).expect(200);
      assert.deepEqual(await order(), [a, c, b, d, e]);
      await builder.post(`/api/orders/${a}/approve`).expect(200);
      assert.deepEqual(await order(), [c, b, a, d, e]);
      const k = await keys();
      assert.equal(new Set(k.values()).size, 5, "no two orders share a key");
      const pos = await positions();
      assert.deepEqual([c, b, a, d, e].map((id) => pos.get(id)), [1, 2, 3, 4, 5]);

      /* at the same time: two approvals that move back, a manual move and a withdraw */
      await revise(user, b, x2dPlate1Plus(20)).expect(200);
      await revise(user, d, x2dPlate1Plus(20)).expect(200);
      await revise(user, a, x2dPlate1Plus(5)).expect(200);
      await Promise.all([
        builder.post(`/api/orders/${b}/approve`).expect(200),
        builder.post(`/api/orders/${d}/approve`).expect(200),
        user.post(`/api/orders/${a}/withdraw`).expect(200),
        builder.post("/api/queue/reorder").send({ orderId: e, toPosition: 1 }).expect(204),
      ]);
      const after = await keys();
      assert.equal(new Set(after.values()).size, 5, "still no shared keys");
      assert.deepEqual([...(await positions()).values()].sort(), [1, 2, 3, 4, 5]);
    });

    it("lets small changes through without review when 轻微修改自动审核 is on", async () => {
      await setRules((r) => (r.revisions.autoApproveMinor = true));
      const a = await queued(user);
      const v = (await revise(user, a, x2dPlate1Plus(15)).expect(200)).body as OrderView;
      assert.equal(v.status, "QUEUED");
      assert.equal(v.revision, null);
      const big = (await revise(user, a, x2dPlate1Plus(16)).expect(200)).body as OrderView;
      assert.equal(big.status, "PENDING_REVIEW", "over the threshold still goes to review");
    });

    it("recalls a dispatched job that has not started, and refuses once printing", async () => {
      const a = await queued(user);
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, x2d));
      await builder.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(200);
      t.commands.online = true;
      await t.app.get(SchedulerService).dispatch(x2d);
      assert.equal((await user.get(`/api/orders/${a}`).expect(200)).body.canRevise, true);

      const v = (await revise(user, a, x2dPlate1Plus(5)).expect(200)).body as OrderView;
      assert.equal(v.status, "PENDING_REVIEW");
      assert.equal(v.revision!.recalled, true);
      assert.equal(v.printer, null);
      const [p] = await t.db.select().from(printers).where(eq(printers.id, x2d));
      assert.equal(p.state, "IDLE");
      assert.equal(p.currentOrderId, null);
      assert.ok(t.commands.sent.some((c) => c.cmd === "recall" && c.arg === a));

      await builder.post(`/api/orders/${a}/approve`).expect(200);
      await t.app.get(SchedulerService).dispatch(x2d);
      await t.app.get(PrintersService).onStarted(x2d);
      const res = await revise(user, a, x2dPlate1Plus(5)).expect(409);
      assert.equal(res.body.code, "order-state-conflict");

      await setRules((r) => (r.revisions.whenDispatched = "refuse"));
      await t.db.update(printers).set({ state: "IDLE", currentOrderId: null }).where(eq(printers.id, x2d));
      const b = await queued(user);
      await t.app.get(SchedulerService).dispatch(x2d);
      assert.equal((await revise(user, b, x2dPlate1Plus(5)).expect(409)).body.code, "already-dispatched");
    });

    it("moves a recalled revision back one extra place, and lets the owner cancel until printing starts", async () => {
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, x2d));
      t.commands.online = true;
      const a = await queued(user);
      await t.app.get(SchedulerService).dispatch(x2d);
      const b = await queued(other);
      const c = await queued(other);
      const v = (await revise(user, a, x2dPlate1Plus(5)).expect(200)).body as OrderView;
      assert.equal(v.revision!.placesBack, 1, "within the time rule, plus one for the recall");
      await builder.post(`/api/orders/${a}/approve`).expect(200);
      const pos = await positions();
      assert.ok(pos.get(b)! < pos.get(a)! && pos.get(a)! < pos.get(c)!, "moved behind the order that was after it, one place only");

      await t.app.get(SchedulerService).dispatch(x2d);
      const [p] = await t.db.select().from(printers).where(eq(printers.id, x2d));
      assert.equal(p.state, "PREPARING");
      const first = p.currentOrderId!;
      const mine = first === a ? user : other;
      assert.equal((await mine.get(`/api/orders/${first}`).expect(200)).body.canCancelOwn, true);
      await mine.post(`/api/orders/${first}/cancel`).send({ reason: "不需要了" }).expect(200);
      assert.ok(t.commands.sent.some((c) => c.cmd === "recall" && c.arg === first));
      await t.app.get(SchedulerService).dispatch(x2d);
      const [p2] = await t.db.select().from(printers).where(eq(printers.id, x2d));
      const next = p2.currentOrderId!;
      assert.notEqual(next, first, "Staff sent the next suggestion");
      await t.app.get(PrintersService).onStarted(x2d);
      const owner = next === a ? user : other;
      assert.equal((await owner.get(`/api/orders/${next}`).expect(200)).body.canCancelOwn, false);
      assert.equal((await owner.post(`/api/orders/${next}/cancel`).send({ reason: "不需要了" }).expect(409)).body.code, "order-state-conflict");
      assert.equal((await revise(owner, next, x2dPlate1Plus(5)).expect(409)).body.code, "order-state-conflict");
    });

    it("refuses revisions when they are off", async () => {
      await setRules((r) => (r.revisions.enabled = false));
      const a = await queued(user);
      assert.equal((await user.get(`/api/orders/${a}`).expect(200)).body.canRevise, false);
      assert.equal((await revise(user, a, x2dPlate1Plus(5)).expect(409)).body.code, "revisions-disabled");
    });
  });

  describe("换机型", () => {
    it("keeps the original place once, counts as a revision; dual → single does not count", async () => {
      const n7 = await addPrinter("N7-dual", "N7");
      const n7single = await addPrinter("N7-single", "N7", [{ extruder: 1, diameter: 0.4 }]);
      await builder.post(`/api/printers/${n7}/open`).send({ open: true }).expect(200);
      await builder.post(`/api/printers/${n7single}/open`).send({ open: true }).expect(200);

      const a = await queued(user);
      const b = await queued(other);
      const v = (await revise(user, a, x2dTwoPlates(P2S)).expect(200)).body as OrderView;
      assert.equal(v.revision!.kind, "model-switch");
      assert.equal(v.printerModelId, "N7");
      assert.deepEqual(v.revisions, { count: 1, max: 3, switches: 1, maxSwitches: 1, baselineSeconds: PLATE1_SECONDS });
      await builder.post(`/api/orders/${a}/approve`).expect(200);
      const pos = await positions();
      assert.ok(pos.get(a)! < pos.get(b)!, "original submit time");
      assert.equal((await revise(user, a, x2dTwoPlates()).expect(409)).body.code, "model-switch-limit");

      const c = await queued(user);
      const d = (await revise(user, c, x2dTwoPlates(singleN7)).expect(200)).body as OrderView;
      assert.equal(d.revision!.kind, "dual-to-single");
      assert.deepEqual(d.revisions, { count: 0, max: 3, switches: 1, maxSwitches: 1, baselineSeconds: PLATE1_SECONDS });
    });
  });

  describe("跳单提醒", () => {
    it("puts an order passed over for 30 minutes on 待办", async () => {
      const n7 = await addPrinter("N7-skip", "N7");
      await t.db.update(printers).set({ openToContestants: true, state: "MAINTENANCE" }).where(eq(printers.id, n7));
      await builder.post(`/api/printers/${x2d}/open`).send({ open: true }).expect(200);
      /* the head of the queue is for N7, which is down; the X2D takes the next one */
      const head = (await submit(user, x2dTwoPlates(P2S)).expect(201)).body.orders[0].id as number;
      await builder.post(`/api/orders/${head}/approve`).expect(200);
      await queued(other);
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, x2d));
      t.commands.online = true;
      await t.app.get(SchedulerService).dispatch(x2d);

      const [o] = await t.db.select().from(orders).where(eq(orders.id, head));
      assert.ok(o.skippedSince);
      let todo = (await staff.get("/api/todo").expect(200)).body as TodoView;
      assert.equal(todo.skipped.length, 0, "not yet");
      await t.db.update(orders).set({ skippedSince: new Date(Date.now() - 31 * 60e3) }).where(eq(orders.id, head));
      todo = (await staff.get("/api/todo").expect(200)).body;
      assert.deepEqual(todo.skipped.map((s) => s.order.id), [head]);
      assert.equal(((await staff.get("/api/overview").expect(200)).body as { todo: number }).todo >= 1, true);

      await setRules((r) => (r.skipReminderMinutes = 60));
      assert.equal(((await staff.get("/api/todo").expect(200)).body as TodoView).skipped.length, 0);
      await t.db.update(printers).set({ openToContestants: false }).where(eq(printers.id, n7));
    });
  });

  describe("settings", () => {
    it("validates the rules and lets anyone signed in read them", async () => {
      assert.deepEqual((await user.get("/api/rules").expect(200)).body, DEFAULT_QUEUE_RULES);
      await user.put("/api/settings/rules").send(DEFAULT_QUEUE_RULES).expect(403);
      await builder.put("/api/settings/rules").send({ ...DEFAULT_QUEUE_RULES, skipReminderMinutes: 0 }).expect(400);
      await setRules((r) => (r.revisions.max = 5));
      assert.equal((await builder.get("/api/settings").expect(200)).body.rules.revisions.max, 5);
    });
  });
});
