import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PRESET_ROLES } from "@platerelay/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { orders, pickupCodes, printers, roles } from "../src/db/schema.js";
import { normalizeCode } from "../src/orders/pickup.service.js";
import { aliasOf } from "../src/orders/views.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { SchedulerService } from "../src/printers/scheduler.service.js";
import { JPEG, startApp, type TestApp, x2dTwoPlates } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

describe("panel API", () => {
  let t: TestApp;
  let user: Agent, userId: string, other: Agent, staff: Agent, builder: Agent, builder2: Agent;
  let printerId: string;

  const submit = (a: Agent, answers: unknown = { reason: "比赛结构件" }) =>
    a.post("/api/orders").attach("file", x2dTwoPlates(), "猫耳外壳.gcode.3mf").field("answers", JSON.stringify(answers));

  /** A printer as its daemon would report it: X2D, two 0.4 nozzles, writable internal storage, idle. */
  async function addPrinter(name: string) {
    const res = await builder.post("/api/printers").send({ name, ip: "192.0.2.10", serial: `SN${name.replace(/\W/g, "")}0001` }).expect(201);
    await t.db
      .update(printers)
      .set({ openToContestants: true, model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "IDLE" })
      .where(eq(printers.id, res.body.id));
    return res.body.id as string;
  }

  const status = async (id: number) => (await t.db.select({ s: orders.status }).from(orders).where(eq(orders.id, id)))[0].s;
  const printerState = async (id: string) => (await t.db.select({ s: printers.state }).from(printers).where(eq(printers.id, id)))[0].s;

  before(async () => {
    t = await startApp();
    ({ agent: user, id: userId } = await t.as("user", "林小满"));
    ({ agent: other } = await t.as("user", "周浩然"));
    ({ agent: staff } = await t.as("staff", "陈一帆"));
    ({ agent: builder } = await t.as("builder", "赵乐"));
    ({ agent: builder2 } = await t.as("coreteam", "Admin"));
    printerId = await addPrinter("X2D-01");
  });
  after(() => t.close());

  describe("auth", () => {
    it("signs up as User, refuses bad passwords, signs out", async () => {
      const a = request.agent(t.app.getHttpServer());
      const me = await a.post("/api/auth/register").send({ username: "newbie", displayName: "新人", password: "longpassword" }).expect(201);
      assert.equal(me.body.role.name, "User");
      assert.match(me.body.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/, "ids are UUID v7");
      assert.deepEqual(me.body.permissions, [...PRESET_ROLES.user.permissions].sort());
      await a.post("/api/auth/register").send({ username: "NEWBIE", displayName: "x", password: "longpassword" }).expect(409);
      await request(t.app.getHttpServer()).post("/api/auth/login").send({ username: "newbie", password: "wrong" }).expect(401);
      await a.post("/api/auth/logout").expect(204);
      await a.get("/api/auth/me").expect(401);
    });

    it("refuses missing permissions with 403 and audits the refusal", async () => {
      await user.get("/api/review").expect(403);
      const log = await builder.get("/api/audit").query({ limit: 20 }).expect(200);
      assert.ok(log.body.some((e: { result: string; reason: string }) => e.result === "denied" && e.reason.includes("order:review")));
    });

    it("keeps the audit log append-only", async () => {
      const appendOnly = (e: unknown) => /append-only/.test(String((e as Error).cause ?? e));
      await assert.rejects(t.db.execute(sql`update audit_log set action = 'x'`), appendOnly);
      await assert.rejects(t.db.execute(sql`delete from audit_log`), appendOnly);
    });
  });

  describe("submit and review", () => {
    it("checks the request form on the server", async () => {
      const res = await submit(user, {}).expect(400);
      assert.equal(res.body.code, "invalid-answers");
    });

    it("splits a two-plate file into two pending orders", async () => {
      const res = await submit(user).expect(201);
      assert.equal(res.body.orders.length, 2);
      assert.deepEqual(res.body.orders.map((o: { plate: { index: number } }) => o.plate.index), [1, 2]);
      assert.ok(res.body.orders.every((o: { status: string }) => o.status === "PENDING_REVIEW"));
      const thumb = await request(t.app.getHttpServer()).get(res.body.orders[0].thumbUrl).expect(200);
      assert.equal(thumb.headers["content-type"], "image/png");
      await request(t.app.getHttpServer()).get(res.body.orders[0].thumbUrl.replace(/s=[^&]+/, "s=forged")).expect(403);
    });

    it("lets one reviewer win when two act at once", async () => {
      const [o] = (await submit(user).expect(201)).body.orders;
      const results = await Promise.all([builder.post(`/api/orders/${o.id}/approve`), builder2.post(`/api/orders/${o.id}/reject`).send({ reason: "壁厚过薄" })]);
      const codes = results.map((r) => r.status).sort();
      assert.deepEqual(codes, [200, 409]);
      assert.equal(results.find((r) => r.status === 409)!.body.code, "already-reviewed");
      await user.post(`/api/orders/${o.id}/cancel`).send({ reason: "测试" });
    });

    it("requires a reason to reject and hides answers from other submitters", async () => {
      const [o] = (await submit(user).expect(201)).body.orders;
      await builder.post(`/api/orders/${o.id}/reject`).send({}).expect(400);
      await builder.post(`/api/orders/${o.id}/reject`).send({ reason: "壁厚过薄" }).expect(200);
      await other.get(`/api/orders/${o.id}`).expect(404);
      const mine = await user.get(`/api/orders/${o.id}`).expect(200);
      assert.equal(mine.body.status, "REJECTED");
      assert.equal(mine.body.review.reason, "壁厚过薄");
      assert.deepEqual(mine.body.answers, [{ label: "打印原因", value: "比赛结构件" }]);
    });
  });

  describe("queue", () => {
    it("is FIFO, reorderable by Builders, and reordering stays off the submitter's timeline", async () => {
      await t.db.update(printers).set({ state: "MAINTENANCE" }).where(eq(printers.id, printerId));
      const a = (await submit(other).expect(201)).body.orders[0];
      const b = (await submit(other).expect(201)).body.orders[0];
      await builder.post(`/api/orders/${a.id}/approve`).expect(200);
      await builder.post(`/api/orders/${b.id}/approve`).expect(200);
      const before = (await other.get("/api/orders/mine").expect(200)).body as { id: number; queue: { position: number } | null }[];
      const pa = before.find((o) => o.id === a.id)!.queue!.position, pb = before.find((o) => o.id === b.id)!.queue!.position;
      assert.ok(pa < pb);
      await other.post("/api/queue/reorder").send({ orderId: b.id, toPosition: 1 }).expect(403);
      await builder.post("/api/queue/reorder").send({ orderId: b.id, toPosition: 1, reason: "排期调整" }).expect(204);
      const after = (await other.get("/api/orders/mine").expect(200)).body as { id: number; queue: { position: number } | null; waitReason: string | null }[];
      assert.equal(after.find((o) => o.id === b.id)!.queue!.position, 1);
      assert.match(after.find((o) => o.id === b.id)!.waitReason!, /等待兼容的打印机/);
      const detail = await other.get(`/api/orders/${b.id}`).expect(200);
      assert.ok(!detail.body.timeline.some((e: { kind: string }) => e.kind.includes("reorder")));
      /* clean up: cancel both so later tests start with an empty queue */
      for (const o of [a, b]) await other.post(`/api/orders/${o.id}/cancel`).send({ reason: "不需要了" }).expect(200);
      await t.db.update(printers).set({ state: "IDLE" }).where(eq(printers.id, printerId));
    });
  });

  /** Submits, approves and dispatches one plate to the printer. */
  async function printing(): Promise<number> {
    const [o] = (await submit(user).expect(201)).body.orders;
    await builder.post(`/api/orders/${o.id}/approve`).expect(200);
    t.commands.online = true;
    await t.app.get(SchedulerService).dispatch(printerId);
    t.commands.online = false;
    assert.equal(await status(o.id), "PRINTING");
    await t.app.get(PrintersService).onStarted(printerId);
    return o.id;
  }

  describe("print lifecycle", () => {
    it("runs submit → print → error pause → resume → finish → store → pickup", async () => {
      const id = await printing();
      const job = t.commands.sent.find((c) => c.cmd === "start")!.arg as { orderId: number; plateIndex: number };
      assert.deepEqual([job.orderId, job.plateIndex], [id, 1]);

      const printersSvc = t.app.get(PrintersService);
      await printersSvc.onErrorPaused(printerId, { errorId: "e1", vendorCode: "07002000", module: "ams", message: "AMS A2 断料", raisedAt: new Date().toISOString(), actions: ["RESUME_PROBLEM_SOLVED", "STOP"] });
      assert.equal(await status(id), "PRINTING");
      const seenByUser = (await user.get(`/api/orders/${id}`).expect(200)).body;
      assert.equal(seenByUser.waitingForHandler, true);
      assert.equal(seenByUser.error, null);
      assert.equal(seenByUser.timeline.find((e: { kind: string }) => e.kind === "error-paused").data, null);
      const overview = (await user.get(`/api/printers/${printerId}`).expect(200)).body;
      assert.equal(overview.state, "ERROR_PAUSED");
      assert.equal(overview.error, null);
      assert.equal(overview.ip, null);
      const todo = (await staff.get("/api/todo").expect(200)).body;
      assert.equal(todo.errors[0].printer.error.message, "AMS A2 断料");

      await user.post(`/api/printers/${printerId}/resolve`).send({ action: "RESUME_PROBLEM_SOLVED" }).expect(403);
      await staff.post(`/api/printers/${printerId}/resolve`).send({ action: "IGNORE" }).expect(400);
      assert.equal((await staff.post(`/api/printers/${printerId}/resolve`).send({ action: "RESUME_PROBLEM_SOLVED" }).expect(503)).body.code, "printer-unreachable");
      t.commands.online = true;
      await staff.post(`/api/printers/${printerId}/resolve`).send({ action: "RESUME_PROBLEM_SOLVED" }).expect(200);
      t.commands.online = false;
      assert.ok(t.commands.sent.some((c) => c.cmd === "resolve" && c.arg === "RESUME_PROBLEM_SOLVED"));
      await printersSvc.onResumed(printerId);
      await printersSvc.onFinished(printerId);
      assert.equal(await status(id), "PRINTED_AWAITING_STORAGE");
      assert.equal(await printerState(printerId), "CLEARING_REQUIRED");

      await user.post(`/api/orders/${id}/pickup-code`).expect(409);
      await staff.post(`/api/orders/${id}/store`).field("slot", "A-2-3").field("bedCleared", "true").expect(400);
      await staff.post(`/api/orders/${id}/store`).field("slot", "A-2-3").field("bedCleared", "true").attach("photo", JPEG, "p.jpg").expect(200);
      assert.equal(await status(id), "STORED_READY_PICKUP");
      assert.equal(await printerState(printerId), "IDLE");

      await other.post(`/api/orders/${id}/pickup-code`).expect(404);
      const first = (await user.post(`/api/orders/${id}/pickup-code`).expect(200)).body;
      assert.match(first.code, /^PR1-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
      const second = (await user.post(`/api/orders/${id}/pickup-code`).expect(200)).body;
      assert.equal((await staff.get(`/api/pickup/${first.code}`).expect(404)).body.code, "pickup-code-invalid");
      await user.get(`/api/pickup/${second.code}`).expect(403);
      const look = (await staff.get(`/api/pickup/${second.code.toLowerCase()}`).expect(200)).body;
      assert.deepEqual([look.orderId, look.owner.name, look.slot], [id, "林小满", "A-2-3"]);
      const red = (await staff.post(`/api/pickup/${second.code}/redeem`).expect(200)).body;
      assert.deepEqual([red.orderId, red.redeemedBy.name], [id, "陈一帆"]);
      const again = (await staff.post(`/api/pickup/${second.code}/redeem`).expect(409)).body;
      assert.deepEqual([again.code, again.owner.name, again.redeemedBy.name], ["pickup-already-redeemed", "林小满", "陈一帆"]);
      assert.equal(await status(id), "COMPLETED");
      const today = (await staff.get("/api/pickup/redemptions").expect(200)).body;
      assert.equal(today[0].orderId, id);
    });

    it("expires pickup codes after ten minutes", async () => {
      const id = await printing();
      await t.app.get(PrintersService).onFinished(printerId);
      await staff.post(`/api/orders/${id}/store`).field("slot", "B-1-1").field("bedCleared", "true").attach("photo", JPEG, "p.jpg").expect(200);
      const { code } = (await user.post(`/api/orders/${id}/pickup-code`).expect(200)).body;
      await t.db.update(pickupCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(pickupCodes.code, normalizeCode(code)!));
      const res = await staff.post(`/api/pickup/${code}/redeem`).expect(410);
      assert.equal(res.body.code, "pickup-code-expired");
      assert.equal(await status(id), "STORED_READY_PICKUP");
      /* leave nothing behind */
      await builder.post(`/api/orders/${id}/cancel`).send({ reason: "测试" }).expect(200);
    });

    it("fails an order only when a handler stops it, then retries per 失败归因", async () => {
      const id = await printing();
      await t.app.get(PrintersService).onErrorPaused(printerId, { errorId: "e2", vendorCode: "0300", raisedAt: new Date().toISOString(), actions: ["STOP"] });
      await staff.post(`/api/printers/${printerId}/stop`).send({}).expect(400);
      const stopped = (await staff.post(`/api/printers/${printerId}/resolve`).send({ action: "STOP", reason: "耗材问题" }).expect(200)).body;
      assert.equal(stopped.commandSent, false, "no daemon reachable: the failure is still recorded");
      assert.equal(await status(id), "FAILED");
      assert.equal(await printerState(printerId), "CLEARING_REQUIRED");
      const failed = (await user.get(`/api/orders/${id}`).expect(200)).body;
      assert.equal(failed.failure.reason, "耗材问题");

      await staff.post(`/api/orders/${id}/attribute`).send({ attribution: "machine" }).expect(403);
      const seq = (await t.db.select({ q: orders.queueSeq }).from(orders).where(eq(orders.id, id)))[0].q;
      const r = (await builder.post(`/api/orders/${id}/attribute`).send({ attribution: "machine" }).expect(200)).body;
      assert.equal(r.retry.status, "QUEUED");
      assert.equal(r.retry.retryOf, id);
      assert.equal(r.failed.retriedAs, r.retry.id);
      assert.equal((await t.db.select({ q: orders.queueSeq }).from(orders).where(eq(orders.id, r.retry.id)))[0].q, seq);
      await builder.post(`/api/orders/${id}/attribute`).send({ attribution: "model" }).expect(409);
      await builder.post(`/api/orders/${r.retry.id}/cancel`).send({ reason: "测试" }).expect(200);

      await user.post(`/api/printers/${printerId}/clear-bed`).expect(403);
      await staff.post(`/api/printers/${printerId}/clear-bed`).expect(200);
      assert.equal(await printerState(printerId), "IDLE");
    });

    it("sends a model-problem retry back to review", async () => {
      const id = await printing();
      await staff.post(`/api/printers/${printerId}/stop`).send({ reason: "模型 / 切片问题" }).expect(200);
      const r = (await builder.post(`/api/orders/${id}/attribute`).send({ attribution: "model", note: "悬垂没加支撑" }).expect(200)).body;
      assert.equal(r.retry.status, "PENDING_REVIEW");
      await staff.post(`/api/printers/${printerId}/clear-bed`).expect(200);
      await builder.post(`/api/orders/${r.retry.id}/reject`).send({ reason: "请加支撑后重新提交" }).expect(200);
    });

    it("lets submitters cancel only before printing; Builders can cancel a print", async () => {
      const id = await printing();
      const own = await user.post(`/api/orders/${id}/cancel`).send({ reason: "不要了" }).expect(409);
      assert.equal(own.body.status, "PRINTING");
      await other.post(`/api/orders/${id}/cancel`).send({ reason: "x" }).expect(404);
      await builder.post(`/api/orders/${id}/cancel`).send({}).expect(400);
      t.commands.sent = [];
      t.commands.online = true;
      await builder.post(`/api/orders/${id}/cancel`).send({ reason: "排期调整" }).expect(200);
      t.commands.online = false;
      assert.equal(await status(id), "CANCELLED");
      assert.equal(await printerState(printerId), "CLEARING_REQUIRED");
      assert.ok(t.commands.sent.some((c) => c.cmd === "stop"));
      const todo = (await staff.get("/api/todo").expect(200)).body;
      assert.equal(todo.clear[0].printer.id, printerId);
      await staff.post(`/api/printers/${printerId}/clear-bed`).expect(200);
    });

    it("skips parts of a running print: owner or Staff, never all of them, only once sent", async () => {
      const [queued] = (await submit(user).expect(201)).body.orders;
      assert.deepEqual(queued.parts, { total: 9, skipped: 0, allowed: false });
      await user.post(`/api/orders/${queued.id}/skip-parts`).send({ parts: [253] }).expect(409);
      await user.post(`/api/orders/${queued.id}/cancel`).send({ reason: "测试" }).expect(200);

      const id = await printing();
      const view = (await user.get(`/api/orders/${id}/parts`).expect(200)).body;
      assert.equal(view.parts.length, 9);
      assert.deepEqual(view.parts[0], { id: 253, name: "Top-Cover-Cat-v100.stl" });
      assert.equal((await request(t.app.getHttpServer()).get(view.pickUrl).expect(200)).headers["content-type"], "image/png");
      assert.equal((await user.get(`/api/orders/${id}`).expect(200)).body.parts.allowed, true);
      await other.get(`/api/orders/${id}/parts`).expect(404);
      await other.post(`/api/orders/${id}/skip-parts`).send({ parts: [253] }).expect(404);

      const unreachable = await user.post(`/api/orders/${id}/skip-parts`).send({ parts: [253] }).expect(503);
      assert.equal(unreachable.body.code, "printer-unreachable");
      assert.equal((await user.get(`/api/orders/${id}`).expect(200)).body.parts.skipped, 0, "nothing recorded when the command did not go out");

      t.commands.sent = [];
      t.commands.online = true;
      await user.post(`/api/orders/${id}/skip-parts`).send({ parts: [999] }).expect(400);
      const skipped = (await user.post(`/api/orders/${id}/skip-parts`).send({ parts: [253, 264] }).expect(200)).body;
      assert.deepEqual(skipped.parts, { total: 9, skipped: 2, allowed: true });
      assert.deepEqual(t.commands.sent, [{ printerId, cmd: "skip", arg: [253, 264] }]);
      await user.post(`/api/orders/${id}/skip-parts`).send({ parts: [253] }).expect(400);
      const all = await staff.post(`/api/orders/${id}/skip-parts`).send({ parts: [275, 308, 319, 330, 341, 396, 407] }).expect(409);
      assert.equal(all.body.code, "skip-all");
      await staff.post(`/api/orders/${id}/skip-parts`).send({ parts: [407] }).expect(200);
      t.commands.online = false;

      const detail = (await user.get(`/api/orders/${id}`).expect(200)).body;
      assert.deepEqual(
        detail.timeline.filter((e: { kind: string }) => e.kind === "skip-parts").map((e: { data: { parts: { id: number }[] } }) => e.data.parts.map((p) => p.id)),
        [[253, 264], [407]],
      );
      const log = (await builder.get("/api/audit").query({ targetType: "order", targetId: String(id) }).expect(200)).body as { action: string; result: string }[];
      assert.deepEqual(log.filter((e) => e.action === "order.skip-parts").map((e) => e.result).sort(), ["denied", "failed", "ok", "ok"]);
      await builder.post(`/api/orders/${id}/cancel`).send({ reason: "测试" }).expect(200);
      await staff.post(`/api/printers/${printerId}/clear-bed`).expect(200);

    });
  });
  describe("visibility and settings", () => {
    it("anonymizes other submitters without order:submitter-name:view-others", async () => {
      const id = await printing();
      const seen = async () => (await other.get(`/api/printers/${printerId}`).expect(200)).body.job.owner;
      assert.equal((await seen()).name, "林小满");
      await t.db.update(roles).set({ permissions: PRESET_ROLES.user.permissions.filter((p) => p !== "order:submitter-name:view-others") }).where(eq(roles.id, "user"));
      assert.deepEqual(await seen(), { id: null, name: aliasOf(userId), role: null });
      assert.equal((await user.get(`/api/printers/${printerId}`).expect(200)).body.job.owner.name, "林小满");
      await t.db.update(roles).set({ permissions: [...PRESET_ROLES.user.permissions] }).where(eq(roles.id, "user"));
      await builder.post(`/api/orders/${id}/cancel`).send({ reason: "测试" }).expect(200);
      await staff.post(`/api/printers/${printerId}/clear-bed`).expect(200);
    });

    it("versions the request form and keeps answers as submitted", async () => {
      const [o] = (await submit(user).expect(201)).body.orders;
      await staff.put("/api/form").send({ fields: [] }).expect(403);
      const fields = [
        { id: "reason", label: "打印用途", type: "textarea", required: true },
        { id: "team", label: "所属队伍", type: "single", required: true, options: ["Team 01", "Team 02"] },
      ];
      const v = (await builder.put("/api/form").send({ fields }).expect(200)).body;
      assert.equal(v.version, 2);
      assert.equal((await submit(user, { reason: "x", team: "Team 09" }).expect(400)).body.code, "invalid-answers");
      await submit(user, { reason: "x", team: "Team 02" }).expect(201);
      const old = (await user.get(`/api/orders/${o.id}`).expect(200)).body;
      assert.deepEqual(old.answers, [{ label: "打印原因", value: "比赛结构件" }]);
    });

    it("shows a daemon token once and keeps only its tail", async () => {
      const d = (await builder.post("/api/daemons").send({ name: "场馆 A 区", network: "192.168.0.0/24" }).expect(201)).body;
      assert.match(d.token, /^plr_[a-z2-7]{40}$/);
      const list = (await builder.get("/api/daemons").expect(200)).body;
      assert.equal(list[0].tokenTail, d.token.slice(-4));
      assert.ok(!("token" in list[0]));
      const log = (await builder.get("/api/audit").query({ targetType: "daemon" }).expect(200)).body;
      assert.ok(!JSON.stringify(log).includes(d.token));
    });

    it("lets user managers change roles, not their own", async () => {
      const { id } = await t.as("user");
      await staff.put(`/api/users/${id}/role`).send({ role: "staff" }).expect(403);
      await builder.put(`/api/users/${id}/role`).send({ role: "staff" }).expect(204);
      const u = (await builder.get("/api/users").expect(200)).body.find((x: { id: string }) => x.id === id);
      assert.equal(u.roleName, "Staff");
    });
  });
});
