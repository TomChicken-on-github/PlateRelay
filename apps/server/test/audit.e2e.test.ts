import assert from "node:assert/strict";
import { it } from "node:test";
import type { AuditLogView } from "@platerelay/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { AuditService } from "../src/audit/audit.service.js";
import { SYSTEM } from "../src/auth/actor.js";
import { AuthService } from "../src/auth/auth.service.js";
import { auditLog, daemons, orderEvents, orders, pickupCodes, printers, roles, sessions, users } from "../src/db/schema.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { SchedulerService } from "../src/printers/scheduler.service.js";
import { OrdersService } from "../src/orders/orders.service.js";
import { STORAGE, type ObjectStorage } from "../src/storage/storage.js";
import { JPEG, startApp, type TestApp, x2dTwoPlates } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

// Each scenario owns its application, database and object directory. Never use a deployment DB.
async function isolated(run: (t: TestApp) => Promise<void>) {
  assert.ok(!process.env.PLATERELAY_TEST_DATABASE_URL, "audit regression requires in-memory PGlite");
  const t = await startApp();
  try { await run(t); } finally { await t.close(); }
}
async function failAudit(t: TestApp, action: string, run: () => Promise<void>) {
  const audit = t.app.get(AuditService);
  const original = audit.record;
  audit.record = async function (ctx, entry, tx) {
    if (entry.action === action) throw new Error("injected audit persistence failure");
    return original.call(this, ctx, entry, tx);
  };
  try { await run(); } finally { audit.record = original; }
}
const logs = (t: TestApp, action: string, id?: string | number) => t.db.select().from(auditLog).where(and(eq(auditLog.action, action), id === undefined ? undefined : eq(auditLog.targetId, String(id))));
const submit = (a: Agent) => a.post("/api/orders").attach("file", x2dTwoPlates(), "audit.gcode.3mf").field("answers", JSON.stringify({ reason: "审计回归" }));
const order = async (t: TestApp, id: number) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0];
const printer = async (t: TestApp, id: string) => (await t.db.select().from(printers).where(eq(printers.id, id)))[0];
const timeline = (t: TestApp, id: number) => t.db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(orderEvents.id);
async function fixture(t: TestApp) {
  const owner = await t.as("user");
  const other = await t.as("user");
  const admin = await t.as("coreteam");
  const p = (await admin.agent.post("/api/printers").send({ name: "Audit X2D", ip: "192.0.2.10", serial: "AUDIT00001" }).expect(201)).body.id as string;
  await t.db.update(printers).set({ openToContestants: true, model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "IDLE" }).where(eq(printers.id, p));
  const submitted = (await submit(owner.agent).expect(201)).body.orders as { id: number }[];
  const id = submitted[0].id;
  async function dispatch() {
    await admin.agent.post(`/api/orders/${id}/approve`).expect(200);
    t.commands.online = true;
    try { assert.equal(await t.app.get(SchedulerService).dispatch(p), id); } finally { t.commands.online = false; }
  }
  async function finish() {
    await dispatch();
    await t.app.get(PrintersService).onStarted(p);
    await t.app.get(PrintersService).onFinished(p);
  }
  const store = () => admin.agent.post(`/api/orders/${id}/store`).field("slot", "A-1").field("bedCleared", "true").attach("photo", JPEG, "part.jpg");
  return { owner, other, admin, p, id, submitted, dispatch, finish, store };
}

it("audit filters are ANDed, dates inclusive, cursors strict and inputs validated", () => isolated(async (t) => {
  const admin = await t.as("coreteam");
  const actorId = "00000000-0000-4000-8000-000000000001";
  const rows = await t.db.insert(auditLog).values([
    { at: new Date("2026-10-24T00:00:00Z"), actorType: "user", actorId, action: "fixture.query", targetType: "order", targetId: "51", result: "ok" },
    { at: new Date("2026-10-24T01:00:00Z"), actorType: "daemon", action: "fixture.query", targetType: "printer", targetId: "52", result: "failed" },
    { at: new Date("2026-10-24T02:00:00Z"), actorType: "user", actorId, action: "fixture.query", targetType: "order", targetId: "53", result: "denied" },
  ]).returning();
  const query = async (q: Record<string, unknown>) => (await admin.agent.get("/api/audit").query(q).expect(200)).body as { id: number }[];
  const ids = (r: { id: number }[]) => r.map((x) => x.id);
  assert.deepEqual(ids(await query({ action: "fixture.query" })), rows.map((r) => r.id).reverse());
  for (const [q, expected] of [
    [{ actorType: "daemon", result: "failed", targetType: "printer", targetId: "52" }, [rows[1].id]],
    [{ actorId, actorType: "user", result: "denied", targetType: "order", targetId: "53" }, [rows[2].id]],
    [{ actorId, result: "failed" }, []],
    [{ from: rows[1].at.toISOString(), to: rows[1].at.toISOString() }, [rows[1].id]],
    [{ from: rows[0].at.toISOString(), to: rows[2].at.toISOString() }, rows.map((r) => r.id).reverse()],
  ] as [Record<string, unknown>, number[]][]) assert.deepEqual(ids(await query({ action: "fixture.query", ...q })), expected);
  assert.deepEqual(await query({ action: "fixture" }), []);
  const first = await query({ action: "fixture.query", limit: 2 });
  assert.deepEqual(ids(first), [rows[2].id, rows[1].id]);
  await t.db.insert(auditLog).values({ actorType: "system", action: "fixture.query" });
  const second = await query({ action: "fixture.query", limit: 2, beforeId: first[1].id });
  assert.deepEqual(ids(second), [rows[0].id]);
  assert.deepEqual(await query({ action: "fixture.query", beforeId: rows[0].id }), []);
  for (const q of [{ actorId: "bad" }, { actorName: " " }, { actorName: "x".repeat(81) }, { actorType: "bad" }, { result: "bad" }, { from: "bad" }, { to: "bad" }, { from: "2026-10-25", to: "2026-10-24" }, { beforeId: 0 }, { beforeId: -1 }, { beforeId: 1.5 }, { beforeId: "9007199254740992" }, { limit: 501 }, { action: " " }, { action: "x".repeat(161) }]) await admin.agent.get("/api/audit").query(q).expect(400);
}));

it("actor names are literal current-name filters before pagination and cannot match non-user actors", () => isolated(async (t) => {
  const admin = await t.as("coreteam");
  const matching = await t.as("user", "MiXeD%_\\操作员");
  const decoy = await t.as("user", "MiXeDABC操作员");
  const rows = await t.db.insert(auditLog).values([
    { actorType: "user", actorId: matching.id, action: "fixture.actor-name", targetType: "setting", result: "ok" },
    { actorType: "system", actorId: matching.id, action: "fixture.actor-name" },
    { actorType: "user", actorId: matching.id, action: "fixture.actor-name", targetType: "printer", result: "denied" },
    { actorType: "user", actorId: decoy.id, action: "fixture.actor-name" },
    { actorType: "daemon", actorId: matching.id, action: "fixture.actor-name" },
    { actorType: "user", actorId: matching.id, action: "fixture.actor-name" },
    { actorType: "printer", actorId: matching.id, action: "fixture.actor-name" },
  ]).returning();
  const query = async (q: Record<string, unknown>) => (await admin.agent.get("/api/audit").query({ action: "fixture.actor-name", ...q }).expect(200)).body as AuditLogView[];
  const expected = [rows[5].id, rows[2].id, rows[0].id];
  for (const actorName of ["  MIXED%_\\  ", "%", "_", "\\"]) {
    assert.deepEqual((await query({ actorName })).map((r) => r.id), expected);
  }
  const first = await query({ actorName: "mixed%_\\", limit: 1 });
  assert.deepEqual(first.map((r) => r.id), [expected[0]]);
  const second = await query({ actorName: "mixed%_\\", limit: 1, beforeId: first[0].id });
  assert.deepEqual(second.map((r) => r.id), [expected[1]]);
  assert.deepEqual((await query({ actorName: "mixed%_\\", limit: 1, beforeId: second[0].id })).map((r) => r.id), [expected[2]]);
  for (const q of [{ actorType: "system" }, { actorType: "daemon" }, { actorType: "printer" }, { actorId: decoy.id }]) {
    assert.deepEqual(await query({ actorName: "mixed%_\\", ...q }), []);
  }
  assert.deepEqual((await query({ actorName: "mixed%_\\", result: "denied", targetType: "printer" })).map((r) => r.id), [rows[2].id]);
  await t.db.update(users).set({ displayName: "新操作员姓名" }).where(eq(users.id, matching.id));
  await t.db.update(roles).set({ name: "当前选手角色" }).where(eq(roles.id, "user"));
  assert.deepEqual(await query({ actorName: "mixed%_\\" }), []);
  const renamed = await query({ actorName: "新操作员" });
  assert.deepEqual(renamed.map((r) => r.id), expected);
  assert.ok(renamed.every((r) => r.actor?.name === "新操作员姓名" && r.actor.role === "当前选手角色"));
  const reads = await logs(t, "audit.view");
  const recordedFilter = reads.at(-1)!.after as Record<string, unknown>;
  assert.equal(recordedFilter.actorNameFiltered, true);
  assert.equal(recordedFilter.action, "fixture.actor-name");
  assert.equal(recordedFilter.limit, 100);
  assert.ok(!("actorName" in recordedFilter));
  assert.ok(reads.every((row) => !JSON.stringify(row.after).includes("新操作员") && !JSON.stringify(row.after).includes("mixed")));
}));

it("audit-only readers resolve business target names without account-management access", () => isolated(async (t) => {
  const f = await fixture(t);
  const staff = await t.as("staff", "日志查阅员");
  const account = await t.as("user", "被调整账户");
  await t.db.update(roles).set({ permissions: ["audit:view"] }).where(eq(roles.id, "staff"));
  const [daemon] = await t.db.insert(daemons).values({ name: "现场守护进程", tokenHash: "audit-target-hash", tokenTail: "tail" }).returning({ id: daemons.id });
  const rows = await t.db.insert(auditLog).values([
    { actorType: "user", actorId: f.admin.id, action: "fixture.targets", targetType: "printer", targetId: f.p },
    { actorType: "user", actorId: f.admin.id, action: "fixture.targets", targetType: "order", targetId: String(f.id) },
    { actorType: "user", actorId: f.admin.id, action: "fixture.targets", targetType: "user", targetId: account.id },
    { actorType: "user", actorId: f.admin.id, action: "fixture.targets", targetType: "daemon", targetId: daemon.id },
    { actorType: "system", action: "fixture.targets", targetType: "setting", targetId: "auth.registration" },
    { actorType: "system", action: "fixture.targets", targetType: "setting", targetId: "queue.policy" },
    { actorType: "system", action: "fixture.targets", targetType: "setting", targetId: "historic.setting" },
    { actorType: "system", action: "fixture.targets", targetType: "form", targetId: "1" },
    { actorType: "system", action: "fixture.targets", targetType: "historic-object", targetId: account.id },
    { actorType: "system", action: "fixture.targets" },
  ]).returning();
  await staff.agent.get("/api/users").expect(403);
  const response = await staff.agent.get("/api/audit").query({ action: "fixture.targets" }).expect(200);
  const byId = new Map<number, AuditLogView>((response.body as AuditLogView[]).map((r) => [r.id, r]));
  const expected = ["Audit X2D", `订单 #${f.id} · audit.gcode.3mf`, "被调整账户", "现场守护进程", "账户注册设置", "排队策略", "系统设置", "申请表单", "业务记录", null];
  rows.forEach((row, index) => {
    const view = byId.get(row.id)!;
    assert.deepEqual(view.target, expected[index] === null ? null : { name: expected[index] });
  });
  assert.ok(!JSON.stringify(response.body).includes("audit-target-hash"));
  assert.ok(!JSON.stringify(response.body).includes('"tokenTail"'));
  await staff.agent.get("/api/users").expect(403);
}));

it("missing and historical targets use safe recorded names without UUID casts or invented deletion claims", () => isolated(async (t) => {
  const admin = await t.as("coreteam");
  const missing = "00000000-0000-4000-8000-000000000099";
  const fixtures = [
    { targetType: "printer", targetId: missing, expected: "打印机（名称未记录）" },
    { targetType: "daemon", targetId: missing, expected: "守护进程（名称未记录）" },
    { targetType: "printer", targetId: missing, before: { name: "已拆除的 A 机" }, expected: "已拆除的 A 机" },
    { targetType: "daemon", targetId: missing, after: { name: "旧守护进程" }, expected: "旧守护进程" },
    { targetType: "printer", targetId: "not-a-uuid", before: { serial: missing }, expected: "打印机（名称未记录）" },
    { targetType: "daemon", targetId: "historic-daemon", before: { name: missing }, expected: "守护进程（名称未记录）" },
    { targetType: "user", targetId: "historic-account", expected: "账户（名称未记录）" },
    { targetType: "user", targetId: missing, expected: "已删除的账户" },
    { targetType: "order", targetId: "2147483647", expected: "订单 #2147483647" },
    { targetType: "order", targetId: "2147483648", expected: "订单 #2147483648" },
    ...["not-a-number", missing, "9007199254740992", "0", "-1", "1.5", ""].map((targetId) => ({ targetType: "order", targetId, expected: "订单（编号未记录）" })),
  ];
  const rows = await t.db.insert(auditLog).values(fixtures.map(({ expected: _expected, ...target }) => ({ ...target, actorType: "system" as const, actorId: missing, action: "fixture.historic" }))).returning();
  const response = await admin.agent.get("/api/audit").query({ action: "fixture.historic" }).expect(200);
  const byId = new Map<number, AuditLogView>((response.body as AuditLogView[]).map((r) => [r.id, r]));
  rows.forEach((row, index) => {
    const view = byId.get(row.id)!;
    assert.deepEqual(view.target, { name: fixtures[index].expected });
    assert.ok(!view.target!.name.includes(missing));
    assert.deepEqual(view.actor, { id: missing, name: "系统", role: null });
  });
}));

it("audit-only permission exposes no users; reading audits itself and TRUNCATE is forbidden", () => isolated(async (t) => {
  const user = await t.as("user");
  const staff = await t.as("staff");
  await user.agent.get("/api/audit").expect(403);
  await staff.agent.get("/api/audit").expect(403);
  await t.db.update(roles).set({ permissions: ["audit:view"] }).where(eq(roles.id, "staff"));
  const before = await logs(t, "audit.view");
  const res = await staff.agent.get("/api/audit").expect(200);
  const after = await logs(t, "audit.view");
  assert.equal(after.length, before.length + 1);
  assert.equal(after.at(-1)!.actorId, staff.id);
  assert.ok(!res.body.some((r: { id: number }) => r.id === after.at(-1)!.id));
  await staff.agent.get("/api/users").expect(403);
  await failAudit(t, "audit.view", async () => { await staff.agent.get("/api/audit").expect(500); });
  assert.deepEqual(await logs(t, "audit.view"), after);
  const original = await t.db.select().from(auditLog);
  const appendOnly = (e: unknown) => /append-only/.test(String((e as Error).cause ?? e));
  for (const statement of [sql`update audit_log set action = 'tamper'`, sql`delete from audit_log`, sql`truncate audit_log`]) await assert.rejects(t.db.execute(statement), appendOnly);
  assert.deepEqual(await t.db.select().from(auditLog), original);
}));

it("login, logout and star roll back persistence when their audit cannot commit", () => isolated(async (t) => {
  const auth = t.app.get(AuthService);
  const id = await auth.createUser(SYSTEM, { username: "rollback", displayName: "Rollback", password: "rollback-password", role: "coreteam" });
  const sessionRows = () => t.db.select().from(sessions).where(eq(sessions.userId, id));
  await failAudit(t, "auth.login", async () => { await assert.rejects(auth.login(SYSTEM, "rollback", "rollback-password")); });
  assert.deepEqual(await sessionRows(), []);
  const login = await auth.login(SYSTEM, "rollback", "rollback-password");
  const ctx = { ...SYSTEM, actor: login.actor };
  const saved = await sessionRows();
  await failAudit(t, "auth.logout", async () => { await assert.rejects(auth.logout(ctx, login.token)); });
  assert.deepEqual(await sessionRows(), saved);
  assert.ok(await auth.actorForSession(login.token));
  await auth.logout(ctx, login.token);
  assert.deepEqual(await sessionRows(), []);
  const svc = t.app.get(PrintersService);
  const p = await svc.create(ctx, { name: "Rollback", serial: "ROLLBACK0001", ip: "192.0.2.10" });
  await failAudit(t, "printer.star", async () => { await assert.rejects(svc.star(ctx, p.id, true)); });
  assert.equal((await printer(t, p.id)).starred, false);
  assert.deepEqual(await logs(t, "printer.star", p.id), []);
  await svc.star(ctx, p.id, true);
  const [entry] = await logs(t, "printer.star", p.id);
  assert.equal((await printer(t, p.id)).starred, true);
  assert.deepEqual(entry.before, { starred: false });
  assert.deepEqual(entry.after, { starred: true });
}));

it("object denials preserve hidden 404s, pickup codes and action-specific 403", () => isolated(async (t) => {
  const f = await fixture(t);
  await f.finish(); await f.store().expect(200);
  await f.owner.agent.post(`/api/orders/${f.id}/pickup-code`).expect(200);
  const codes = await t.db.select().from(pickupCodes);
  for (const [suffix, action, reason] of [["file", "order.file.download", "missing-permission"], ["pickup-code", "pickup.issue", "not-owner"]]) {
    const before = await logs(t, action);
    const denied = suffix === "file" ? await f.other.agent.get(`/api/orders/${f.id}/${suffix}`).expect(404) : await f.other.agent.post(`/api/orders/${f.id}/${suffix}`).expect(404);
    const missing = suffix === "file" ? await f.other.agent.get(`/api/orders/2147483647/${suffix}`).expect(404) : await f.other.agent.post(`/api/orders/2147483647/${suffix}`).expect(404);
    assert.equal(denied.body.code, missing.body.code);
    const entries = (await logs(t, action)).filter((entry) => !before.some((old) => old.id === entry.id));
    assert.equal(entries.length, 1);
    assert.deepEqual([entries[0].targetId, entries[0].result, entries[0].reason], [String(f.id), "denied", reason]);
  }
  assert.deepEqual(await t.db.select().from(pickupCodes), codes);
  const staff = await t.as("staff");
  await t.db.update(roles).set({ permissions: ["printer:operate"] }).where(eq(roles.id, "staff"));
  const res = await staff.agent.post(`/api/printers/${f.p}/resolve`).send({ action: "STOP", reason: "测试" }).expect(403);
  assert.equal(res.body.code, "forbidden");
  const entries = await logs(t, "printer.stop", f.p);
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].result, entries[0].reason, entries[0].after], ["denied", "missing-permission", { action: "STOP" }]);
}));

it("source signatures precede success audits; previews exclude owners and missing thumbnails", () => isolated(async (t) => {
  const f = await fixture(t);
  const storage = t.app.get<ObjectStorage>(STORAGE);
  const original = storage.signedUrl;
  storage.signedUrl = async () => { throw new Error("signature failure"); };
  try { await f.admin.agent.get(`/api/orders/${f.id}/file`).expect(500); await f.admin.agent.get("/api/review").expect(500); } finally { storage.signedUrl = original; }
  assert.deepEqual(await logs(t, "order.file.download", f.id), []);
  assert.deepEqual(await logs(t, "order.preview.view"), []);
  await f.owner.agent.get(`/api/orders/${f.id}/file`).expect(200);
  assert.deepEqual(await logs(t, "order.file.download", f.id), []);
  await f.admin.agent.get(`/api/orders/${f.id}/file`).expect(200);
  assert.equal((await logs(t, "order.file.download", f.id)).length, 1);
  await f.owner.agent.get("/api/orders/mine").expect(200);
  assert.deepEqual(await logs(t, "order.preview.view"), []);
  await t.db.update(orders).set({ thumbnailKey: null }).where(eq(orders.id, f.submitted[1].id));
  await f.admin.agent.get("/api/review").expect(200);
  const preview = await logs(t, "order.preview.view");
  assert.equal(preview.length, 1);
  assert.deepEqual([preview[0].targetId, preview[0].actorId, preview[0].result], [String(f.id), f.admin.id, "ok"]);
  await failAudit(t, "order.file.download", async () => { await f.admin.agent.get(`/api/orders/${f.id}/file`).expect(500); });
  await failAudit(t, "order.preview.view", async () => { await f.admin.agent.get("/api/review").expect(500); });
}));

it("postcommit preview audit failure cannot delete a stored photo; pickup lookup uses its real actor", () => isolated(async (t) => {
  const f = await fixture(t);
  await f.finish();
  await failAudit(t, "order.preview.view", async () => { await f.store().expect(500); });
  const saved = await order(t, f.id);
  assert.equal(saved.status, "STORED_READY_PICKUP");
  assert.ok(saved.storePhotoKey);
  assert.equal(await t.app.get<ObjectStorage>(STORAGE).exists(saved.storePhotoKey!), true);
  assert.equal((await logs(t, "order.store", f.id)).length, 1);
  const { code } = (await f.owner.agent.post(`/api/orders/${f.id}/pickup-code`).expect(200)).body;
  const before = (await logs(t, "order.preview.view", f.id)).length;
  await f.admin.agent.get(`/api/pickup/${code}`).set("User-Agent", "Audit lookup").expect(200);
  const entries = await logs(t, "order.preview.view", f.id);
  assert.equal(entries.length, before + 1);
  assert.equal(entries.at(-1)!.actorId, f.admin.id);
  assert.equal(entries.at(-1)!.device, "Audit lookup");
  await t.db.update(orders).set({ thumbnailKey: null }).where(eq(orders.id, f.id));
  await f.admin.agent.get(`/api/pickup/${code}`).expect(200);
  assert.equal((await logs(t, "order.preview.view", f.id)).length, entries.length);
}));

it("printer start and finish facts atomically persist states, timeline and audit", () => isolated(async (t) => {
  const f = await fixture(t);
  await f.dispatch();
  const svc = t.app.get(PrintersService);
  for (const [action, invoke, next] of [
    ["printer.started", () => svc.onStarted(f.p), "PRINTING"],
    ["printer.finished", () => svc.onFinished(f.p), "CLEARING_REQUIRED"],
  ] as const) {
    const beforePrinter = await printer(t, f.p), beforeOrder = await order(t, f.id), beforeTimeline = await timeline(t, f.id);
    await failAudit(t, action, async () => { await assert.rejects(invoke()); });
    assert.deepEqual(await printer(t, f.p), beforePrinter);
    assert.deepEqual(await order(t, f.id), beforeOrder);
    assert.deepEqual(await timeline(t, f.id), beforeTimeline);
    assert.deepEqual(await logs(t, action, f.p), []);
    await invoke();
    const [entry] = await logs(t, action, f.p);
    assert.deepEqual([entry.actorType, entry.actorId, entry.result, entry.targetType], ["printer", f.p, "ok", "printer"]);
    assert.deepEqual(entry.before, { state: beforePrinter.state });
    assert.deepEqual(entry.after, { state: next, orderId: f.id });
    assert.equal((await printer(t, f.p)).state, next);
    assert.ok((await timeline(t, f.id)).length > beforeTimeline.length);
  }
  assert.equal((await order(t, f.id)).status, "PRINTED_AWAITING_STORAGE");
  assert.equal((await printer(t, f.p)).currentOrderId, f.id);
}));

it("dispatch failure compensates locally and records a distinct failed command outcome", () => isolated(async (t) => {
  const f = await fixture(t);
  await f.admin.agent.post(`/api/orders/${f.id}/approve`).expect(200);
  assert.equal(await t.app.get(SchedulerService).dispatch(f.p), null);
  const o = await order(t, f.id), p = await printer(t, f.p);
  assert.deepEqual([o.status, o.printerId, p.state, p.currentOrderId], ["QUEUED", null, "IDLE", null]);
  const [decision] = await logs(t, "order.dispatch", f.id), [failure] = await logs(t, "order.dispatch.failed", f.id);
  assert.equal(decision.result, "ok");
  assert.deepEqual([failure.result, failure.reason], ["failed", "send-failed"]);
  assert.deepEqual(failure.before, { status: "PRINTING", printerId: f.p });
  assert.deepEqual(failure.after, { status: "QUEUED", printerId: null });
  assert.deepEqual(t.commands.sent, []);
}));

for (const operation of ["stop", "cancel"] as const) it(`${operation} keeps its committed decision when the fake printer is unreachable`, () => isolated(async (t) => {
  const f = await fixture(t);
  await f.dispatch(); await t.app.get(PrintersService).onStarted(f.p);
  if (operation === "stop") {
    await t.app.get(PrintersService).onErrorPaused(f.p, { errorId: "audit-error", vendorCode: "0300", raisedAt: "2026-10-24T00:00:00Z", actions: ["RESUME_PROBLEM_SOLVED", "STOP"] });
    const failed = await f.admin.agent.post(`/api/printers/${f.p}/resolve`).send({ action: "RESUME_PROBLEM_SOLVED" }).expect(503);
    assert.equal(failed.body.code, "printer-unreachable");
    assert.equal((await printer(t, f.p)).state, "ERROR_PAUSED");
    const [entry] = await logs(t, "printer.error.resolve", f.p);
    assert.deepEqual([entry.result, entry.reason, entry.after], ["failed", "printer-unreachable", { action: "RESUME_PROBLEM_SOLVED", errorId: "audit-error" }]);
  }
  const response = operation === "stop"
    ? await f.admin.agent.post(`/api/printers/${f.p}/resolve`).send({ action: "STOP", reason: "设备故障" }).expect(200)
    : await f.admin.agent.post(`/api/orders/${f.id}/cancel`).send({ reason: "排期变更" }).expect(200);
  if (operation === "stop") assert.equal(response.body.commandSent, false);
  assert.equal((await order(t, f.id)).status, operation === "stop" ? "FAILED" : "CANCELLED");
  assert.equal((await printer(t, f.p)).state, "CLEARING_REQUIRED");
  const [command] = await logs(t, "printer.stop.command", f.p);
  assert.deepEqual([command.result, command.reason, command.after], ["failed", "printer-unreachable", { command: "STOP" }]);
  assert.equal((await logs(t, operation === "stop" ? "printer.stop" : "order.cancel", operation === "stop" ? f.p : f.id))[0].result, "ok");
}));

it("successful STOP call is distinct from physical execution and audit write errors are not command failures", () => isolated(async (t) => {
  const f = await fixture(t);
  await f.dispatch(); await t.app.get(PrintersService).onStarted(f.p);
  t.commands.online = true;
  try {
    await failAudit(t, "printer.stop.command", async () => { await f.admin.agent.post(`/api/printers/${f.p}/stop`).send({ reason: "测试" }).expect(500); });
  } finally { t.commands.online = false; }
  assert.equal((await order(t, f.id)).status, "FAILED");
  assert.equal(t.commands.sent.filter((c) => c.cmd === "stop").length, 1);
  assert.deepEqual(await logs(t, "printer.stop.command", f.p), []);
  assert.equal((await logs(t, "printer.stop", f.p))[0].result, "ok");
}));

it("login, daemon and pickup audits never persist raw credentials or signed URLs", () => isolated(async (t) => {
  const f = await fixture(t);
  const password = "audit-unique-password-917";
  await t.app.get(AuthService).createUser(SYSTEM, { username: "secretcheck", displayName: "Secret check", password, role: "user" });
  const login = await request(t.app.getHttpServer()).post("/api/auth/login").send({ username: "secretcheck", password }).expect(200);
  const cookies = login.headers["set-cookie"] as unknown as string[];
  assert.ok(cookies?.length);
  const sessionToken = decodeURIComponent(cookies[0].split(";")[0].split("=").slice(1).join("="));
  assert.ok(sessionToken.length > 10);
  const daemon = (await f.admin.agent.post("/api/daemons").send({ name: "Audit daemon", network: "192.0.2.0/24" }).expect(201)).body;
  await f.finish(); await f.store().expect(200);
  const { code } = (await f.owner.agent.post(`/api/orders/${f.id}/pickup-code`).expect(200)).body;
  const lookup = await f.admin.agent.get(`/api/pickup/${code}`).expect(200);
  const file = await f.admin.agent.get(`/api/orders/${f.id}/file`).expect(200);
  await f.admin.agent.post(`/api/pickup/${code}/redeem`).expect(200);
  const serialized = JSON.stringify(await t.db.select().from(auditLog));
  for (const secret of [password, sessionToken, daemon.token, code, code.replaceAll("-", ""), file.body.url, lookup.body.thumbUrl].filter(Boolean)) assert.ok(!serialized.includes(secret), "audit must not contain raw credentials, codes or links");
  assert.ok(serialized.includes(daemon.token.slice(-4)), "allowed daemon token tail remains visible");
}));

it("multi-order preview auditing rolls back every entry if a later entry fails", () => isolated(async (t) => {
  const f = await fixture(t);
  const audit = t.app.get(AuditService);
  const original = audit.record;
  let previews = 0;
  audit.record = async function (ctx, entry, tx) {
    if (entry.action === "order.preview.view" && ++previews === 2) throw new Error("second preview audit failed");
    return original.call(this, ctx, entry, tx);
  };
  try { await f.admin.agent.get("/api/review").expect(500); } finally { audit.record = original; }
  assert.equal(previews, 2, "the fixture must exercise a multi-order response");
  assert.deepEqual(await logs(t, "order.preview.view"), []);
  await f.admin.agent.get("/api/review").expect(200);
  const entries = await logs(t, "order.preview.view");
  assert.deepEqual(entries.map((e) => e.targetId).sort(), f.submitted.map((o) => String(o.id)).sort());
}));

it("STOP success and failure audit errors propagate instead of becoming false command outcomes", () => isolated(async (t) => {
  const f = await fixture(t);
  const service = t.app.get(OrdersService);
  for (const online of [true, false]) {
    t.commands.online = online;
    await failAudit(t, "printer.stop.command", async () => {
      await assert.rejects(service.sendStop(SYSTEM, f.p), /injected audit persistence failure/);
    });
    assert.deepEqual(await logs(t, "printer.stop.command", f.p), []);
  }
  t.commands.online = true;
  assert.equal(await service.sendStop(SYSTEM, f.p), true);
  t.commands.online = false;
  assert.equal(await service.sendStop(SYSTEM, f.p), false);
  const entries = await logs(t, "printer.stop.command", f.p);
  assert.deepEqual(entries.map((e) => e.result), ["ok", "failed"]);
  assert.deepEqual(entries.map((e) => e.reason), [null, "printer-unreachable"]);
  for (const entry of entries) assert.deepEqual(entry.after, { command: "STOP" });
}));
