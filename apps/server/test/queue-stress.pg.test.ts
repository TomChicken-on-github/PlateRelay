import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_QUEUE_RULES, type OrderDetail, type OrderView, type TodoView } from "@platerelay/shared";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { orders, orderVersions, printers } from "../src/db/schema.js";
import { inQueue } from "../src/orders/queue.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { SchedulerService } from "../src/printers/scheduler.service.js";
import { JPEG, startApp, type TestApp, x2dPlate1Plus } from "./helpers.js";

/*
 * Concurrency stress for the queue, against a real PostgreSQL (many connections, real row and advisory
 * locks). Only runs with PLATERELAY_TEST_DATABASE_URL pointing at an empty database; PGlite runs one
 * statement at a time, so it cannot show races. Every round fires a burst of concurrent requests and
 * printer events, waits for them, then checks the invariants.
 */

const URL = process.env.PLATERELAY_TEST_DATABASE_URL;
const ROUNDS = Number(process.env.STRESS_ROUNDS ?? 40);

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

/* deterministic, so a failing run can be replayed with the same seed */
let seed = Number(process.env.STRESS_SEED ?? 20261027);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]): T | undefined => xs[Math.floor(rand() * xs.length)];

describe("queue under concurrent load (real PostgreSQL)", { skip: !URL && "set PLATERELAY_TEST_DATABASE_URL to an empty database" }, () => {
  let t: TestApp;
  let builder: Agent, staff: Agent;
  const users: Agent[] = [];
  const owner = new Map<number, Agent>();
  const created = new Set<number>();
  let printerIds: string[] = [];
  const failures: string[] = [];
  const ops: Record<string, Record<string, number>> = {};

  /** Runs one request; anything but a business answer (2xx, 400, 404, 409, 422) is a failure. */
  async function call(name: string, req: PromiseLike<{ status: number; body: unknown }>) {
    let status: number;
    let body: unknown;
    try {
      const res = await Promise.race([req, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout after 30 s")), 30e3))]);
      ({ status, body } = res);
    } catch (e) {
      failures.push(`${name}: ${(e as Error).message}`);
      return null;
    }
    (ops[name] ??= {})[status] = (ops[name][status] ?? 0) + 1;
    if (![200, 201, 204, 400, 404, 409, 422].includes(status)) failures.push(`${name}: HTTP ${status} ${JSON.stringify(body).slice(0, 300)}`);
    return status < 300 ? body : null;
  }

  async function submit() {
    const u = pick(users)!;
    const body = (await call("submit", u.post("/api/orders").attach("file", x2dPlate1Plus(Math.floor(rand() * 60) - 30), "压测.gcode.3mf").field("answers", JSON.stringify({ reason: "压测" })).field("plates", "[1]"))) as { orders: OrderView[] } | null;
    for (const o of body?.orders ?? []) {
      created.add(o.id);
      owner.set(o.id, u);
    }
  }

  const rows = () => t.db.select().from(orders).where(inArray(orders.id, [...created].length ? [...created] : [-1]));

  before(async () => {
    t = await startApp();
    ({ agent: builder } = await t.as("builder", "压测 Builder"));
    ({ agent: staff } = await t.as("staff", "压测 Staff"));
    for (let i = 0; i < 6; i++) users.push((await t.as("user", `压测选手${i}`)).agent);
    const rules = structuredClone(DEFAULT_QUEUE_RULES);
    rules.revisions.max = 0;
    rules.revisions.autoApproveMinor = true;
    rules.modelSwitch.max = 0;
    await builder.put("/api/settings/rules").send(rules).expect(204);
    for (let i = 0; i < 4; i++) {
      const res = await builder.post("/api/printers").send({ name: `X2D-S${i}`, ip: "192.0.2.30", serial: `SNSTRESS000${i}` }).expect(201);
      printerIds.push(res.body.id);
    }
    await t.db
      .update(printers)
      .set({ model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "IDLE", openToContestants: true })
      .where(inArray(printers.id, printerIds));
    /* every printer takes every order and Staff confirm the head first, so any order passed over while ahead of a dispatched one is out-of-order dispatch */
    await t.db.execute(sql`create table if not exists stress_skips (order_id int, at timestamptz default now())`);
    await t.db.execute(sql`create or replace function stress_skip() returns trigger language plpgsql as $$ begin insert into stress_skips(order_id) values (new.id); return new; end $$`);
    await t.db.execute(sql`create or replace trigger stress_skip after update of skipped_since on orders for each row when (old.skipped_since is null and new.skipped_since is not null) execute function stress_skip()`);
    t.commands.online = true;
    for (let i = 0; i < 12; i++) await submit();
    for (const id of created) await call("approve", builder.post(`/api/orders/${id}/approve`));
  });
  after(() => t?.close());

  async function queueOrder(): Promise<number[]> {
    const q = await t.db.select({ id: orders.id }).from(orders).where(inQueue).orderBy(orders.queueSeq, orders.id);
    return q.map((o) => o.id);
  }

  /** One burst of everything at once: each op chooses its target from the state before the burst. */
  async function burst(): Promise<Set<number>> {
    const all = await rows();
    const by = (f: (o: (typeof all)[number]) => boolean) => all.filter(f);
    const queued = by((o) => o.status === "QUEUED");
    const pending = by((o) => o.status === "PENDING_REVIEW");
    const revising = pending.filter((o) => o.pendingVersionId != null);
    const printing = by((o) => o.status === "PRINTING");
    const fleet = await t.db.select().from(printers).where(inArray(printers.id, printerIds));
    const sugg = await suggestions();
    const touched = new Set<number>();
    const jobs: Promise<unknown>[] = [];
    const go = (id: number | undefined, f: (id: number) => Promise<unknown>) => {
      if (id == null) return;
      touched.add(id);
      jobs.push(f(id));
    };
    const as = (id: number) => owner.get(id)!;

    for (let i = 0; i < 3; i++) jobs.push(submit());
    for (let i = 0; i < 3; i++) go(pick(queued)?.id, (id) => call("revise", as(id).post(`/api/orders/${id}/revise`).attach("file", x2dPlate1Plus(Math.floor(rand() * 70) - 20), "压测-改.gcode.3mf")));
    go(pick(printing)?.id, (id) => call("revise-dispatched", as(id).post(`/api/orders/${id}/revise`).attach("file", x2dPlate1Plus(Math.floor(rand() * 40)), "压测-召回.gcode.3mf")));
    for (let i = 0; i < 3; i++) go(pick(pending)?.id, (id) => call("approve", builder.post(`/api/orders/${id}/approve`)));
    go(pick(pending)?.id, (id) => call("reject", builder.post(`/api/orders/${id}/reject`).send({ reason: "压测驳回" })));
    go(pick(revising)?.id, (id) => call("withdraw", as(id).post(`/api/orders/${id}/withdraw`)));
    go(pick(queued)?.id, (id) => call("restore", as(id).post(`/api/orders/${id}/versions/1/restore`)));
    for (let i = 0; i < 2; i++) go(pick(queued)?.id, (id) => call("reorder", builder.post("/api/queue/reorder").send({ orderId: id, toPosition: 1 + Math.floor(rand() * Math.max(1, queued.length)) })));
    go(pick(queued)?.id, (id) => call("cancel", as(id).post(`/api/orders/${id}/cancel`).send({ reason: "压测取消" })));

    /* the printers report at the same time */
    const ps = t.app.get(PrintersService);
    for (const p of fleet) {
      const ev = async (name: string, f: () => Promise<unknown>) => {
        try {
          await f();
          (ops[name] ??= {}).ok = (ops[name].ok ?? 0) + 1;
        } catch (e) {
          const status = (e as { getStatus?: () => number }).getStatus?.();
          if (status && status < 500) (ops[name] ??= {})[status] = (ops[name][status] ?? 0) + 1;
          else failures.push(`${name}: ${(e as Error).message}`);
        }
      };
      if (p.currentOrderId != null) touched.add(p.currentOrderId);
      if (p.state === "PREPARING") jobs.push(rand() < 0.85 ? ev("printer.started", () => ps.onStarted(p.id)) : ev("printer.prepare-failed", () => ps.onPrepareFailed(p.id, "压测")));
      else if (p.state === "PRINTING") jobs.push(ev("printer.finished", () => ps.onFinished(p.id)));
      else if (p.state === "CLEARING_REQUIRED" && p.currentOrderId != null && all.find((o) => o.id === p.currentOrderId)?.status === "PRINTED_AWAITING_STORAGE") {
        const id = p.currentOrderId;
        jobs.push(call("store", staff.post(`/api/orders/${id}/store`).attach("photo", JPEG, "p.jpg").field("slot", "A-1-1").field("bedCleared", "true")).then(() => confirmFreed(p.id)));
      } else if (p.state === "CLEARING_REQUIRED") jobs.push(call("clear-bed", staff.post(`/api/printers/${p.id}/clear-bed`)).then(() => confirmFreed(p.id)));
    }
    /* Staff send the current suggestion (no orderId) to the printer idle longest, twice at once: one wins, the other gets a 409.
       Picking another order on purpose is a skip, so the burst always sends the suggestion. */
    const head = sugg[0];
    if (head) for (let i = 0; i < 2; i++) go(head.order, () => call("confirm-dispatch", staff.post(`/api/printers/${head.printer}/dispatch`).send({})));
    await Promise.all(jobs);
    await confirmAll();
    return touched;
  }

  /** What 待办 suggests now, in the order Staff see it (longest idle first). */
  async function suggestions() {
    const todo = (await staff.get("/api/todo").expect(200)).body as TodoView;
    return todo.dispatch.filter((d) => printerIds.includes(d.printer.id)).map((d) => ({ printer: d.printer.id, order: d.order.id }));
  }

  /** A bed just cleared: two Staff confirm its suggestion at once, while the rest of the burst runs. */
  async function confirmFreed(printerId: string) {
    const d = (await suggestions()).find((x) => x.printer === printerId);
    if (d) await Promise.all([0, 1].map(() => call("confirm-dispatch", staff.post(`/api/printers/${printerId}/dispatch`).send({}))));
  }

  /** Staff confirm every suggestion one by one, as the scheduler used to dispatch on its own. */
  async function confirmAll() {
    for (const d of await suggestions()) await call("confirm-dispatch", staff.post(`/api/printers/${d.printer}/dispatch`).send({}));
  }

  async function check(round: number, before: number[], touched: Set<number>) {
    const where = `round ${round}`;
    const all = await rows();
    assert.equal(all.length, created.size, `${where}: every created order is there once`);

    /* keys: present, unique, positions 1..n with no gaps */
    const q = all.filter((o) => o.status === "QUEUED" || (o.status === "PENDING_REVIEW" && o.queueSeq != null));
    assert.ok(q.every((o) => o.queueSeq != null), `${where}: queued orders have keys`);
    assert.equal(new Set(q.map((o) => o.queueSeq)).size, q.length, `${where}: no two queued orders share a key`);
    const pos = await t.app.get(SchedulerService).queuePositions();
    assert.deepEqual([...pos.values()].map((p) => p.position).sort((a, b) => a - b), q.map((_, i) => i + 1), `${where}: positions are 1..n`);

    /* orders nobody touched this round keep their relative order */
    const now = await queueOrder();
    const keep = (xs: number[]) => xs.filter((id) => !touched.has(id) && before.includes(id) && now.includes(id));
    assert.deepEqual(keep(now), keep(before), `${where}: untouched orders kept their order`);

    /* printers and orders agree */
    const fleet = await t.db.select().from(printers).where(inArray(printers.id, printerIds));
    const held = fleet.flatMap((p) => (p.currentOrderId != null ? [p.currentOrderId] : []));
    assert.equal(new Set(held).size, held.length, `${where}: no order on two printers`);
    for (const o of all.filter((x) => x.status === "PRINTING")) {
      const p = fleet.find((x) => x.id === o.printerId);
      assert.ok(p && p.currentOrderId === o.id && ["PREPARING", "PRINTING", "ERROR_PAUSED"].includes(p.state), `${where}: printing order #${o.id} is on its printer`);
    }
    for (const p of fleet.filter((x) => x.state === "PREPARING" || x.state === "PRINTING")) {
      const o = all.find((x) => x.id === p.currentOrderId);
      assert.ok(o && o.status === "PRINTING" && o.printerId === p.id, `${where}: busy printer ${p.name} holds a printing order`);
    }

    /* versions: one pending exactly while a file waits for review, pointed at by the order, and a queued or frozen order holds an approved version */
    const vs = await t.db.select().from(orderVersions).where(inArray(orderVersions.orderId, all.map((o) => o.id)));
    for (const o of all) {
      const mine = vs.filter((v) => v.orderId === o.id);
      const pend = mine.filter((v) => v.state === "pending");
      assert.equal(pend.length, o.status === "PENDING_REVIEW" ? 1 : 0, `${where}: #${o.id} (${o.status}) has ${pend.length} pending versions`);
      if (pend.length) assert.equal(pend[0].id, o.pendingVersionId ?? o.activeVersionId, `${where}: #${o.id} points at the version under review`);
      const active = mine.find((v) => v.id === o.activeVersionId);
      if (o.status === "QUEUED" || o.status === "PRINTING" || o.pendingVersionId != null) assert.equal(active?.state, "approved", `${where}: #${o.id} prints an approved version`);
    }

    /* no queued order was ever passed over: every printer takes every order */
    const skips = (await t.db.execute(sql`select count(*)::int as n from stress_skips`)) as unknown as { rows: { n: number }[] };
    assert.equal(skips.rows[0].n, 0, `${where}: an order was passed over (out-of-order dispatch)`);
  }

  it(`stays consistent over ${ROUNDS} bursts`, async () => {
    for (let r = 1; r <= ROUNDS; r++) {
      const before = await queueOrder();
      const touched = await burst();
      assert.deepEqual(failures, [], `round ${r}: requests failed`);
      await check(r, before, touched);
    }
    const n = (await rows()).length;
    const reviewed = (await t.db.select({ n: sql<number>`count(*)::int` }).from(orders).where(and(inArray(orders.id, [...created]), isNotNull(orders.queueSeq))))[0].n;
    console.log(JSON.stringify({ rounds: ROUNDS, orders: n, everQueued: reviewed, ops }, null, 1));
    /* the detail endpoint still reads every order */
    for (const id of [...created].slice(0, 20)) await builder.get(`/api/orders/${id}`).expect(200).then((r) => assert.ok((r.body as OrderDetail).versions));
  });
});
