import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { OrderDetail, OrderView } from "@platerelay/shared";
import { asc, eq, sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { type Db, openDb } from "../src/db/db.js";
import { files, orders, orderVersions, printers, users } from "../src/db/schema.js";
import { orderRow } from "../src/orders/rows.js";
import { createOrder, type VersionFields } from "../src/orders/versions.js";
import { PLATE1_SECONDS, startApp, type TestApp, x2dPlate1Plus, x2dTwoPlates } from "./helpers.js";

const MIGRATIONS = join(__dirname, "../../drizzle");

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

const fields = (fileId: string, printSeconds = 600): VersionFields => ({
  fileId,
  plateIndex: 1,
  plateCount: 1,
  plateName: "",
  printerModel: "Bambu Lab X2D",
  printerModelId: "N6",
  nozzles: [{ extruder: 1, side: null, diameter: 0.4 }],
  filaments: [],
  printSeconds,
  weightGrams: 10,
  thumbnailKey: null,
  parts: [],
  partsTopKey: null,
  partsPickKey: null,
});

describe("order versions are immutable and orders only point at them", () => {
  let t: TestApp;
  let user: Agent, builder: Agent;
  const versions = (id: number) => t.db.select().from(orderVersions).where(eq(orderVersions.orderId, id)).orderBy(asc(orderVersions.n));
  const pointers = async (id: number) => {
    const [o] = await t.db.select({ active: orders.activeVersionId, pending: orders.pendingVersionId }).from(orders).where(eq(orders.id, id));
    const vs = await versions(id);
    const n = (vid: number | null) => vs.find((v) => v.id === vid)?.n ?? null;
    return { active: n(o.active), pending: n(o.pending) };
  };
  const submit = async () => {
    const res = await user.post("/api/orders").attach("file", x2dTwoPlates(), "外壳.gcode.3mf").field("answers", JSON.stringify({ reason: "比赛" })).field("plates", "[1]").expect(201);
    return res.body.orders[0].id as number;
  };
  const revise = (id: number, file: Buffer) => user.post(`/api/orders/${id}/revise`).attach("file", file, "外壳-v2.gcode.3mf");

  before(async () => {
    t = await startApp();
    ({ agent: user } = await t.as("user"));
    ({ agent: builder } = await t.as("builder"));
    /* plates are only taken when the event has a printer for them */
    const res = await builder.post("/api/printers").send({ name: "X2D-01", ip: "192.0.2.20", serial: "SNX2D010001" }).expect(201);
    await t.db
      .update(printers)
      .set({ model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "MAINTENANCE", openToContestants: true })
      .where(eq(printers.id, res.body.id));
  });
  after(() => t.close());

  it("moves the pointers on revise, withdraw, reject, approve and restore, and never rewrites a version", async () => {
    const a = await submit();
    assert.deepEqual(await pointers(a), { active: 1, pending: null }, "a submission is the active version, waiting for its first review");
    await builder.post(`/api/orders/${a}/approve`).expect(200);
    const [v1] = await versions(a);
    assert.equal(v1.state, "approved");

    await revise(a, x2dPlate1Plus(40)).expect(200);
    assert.deepEqual(await pointers(a), { active: 1, pending: 2 }, "a revision waits next to the approved version");
    const [, v2] = await versions(a);
    assert.deepEqual(v2.decision, { deltaSeconds: 2400, placesBack: 2, recalled: false }, "the policy's decision is stored with the version");

    await user.post(`/api/orders/${a}/withdraw`).expect(200);
    assert.deepEqual(await pointers(a), { active: 1, pending: null });

    await revise(a, x2dPlate1Plus(10)).expect(200);
    let v = (await builder.post(`/api/orders/${a}/reject`).send({ reason: "支撑太多" }).expect(200)).body as OrderView;
    assert.deepEqual(await pointers(a), { active: 1, pending: null });
    assert.equal(v.printSeconds, PLATE1_SECONDS);

    await revise(a, x2dPlate1Plus(-5)).expect(200);
    await builder.post(`/api/orders/${a}/approve`).expect(200);
    assert.deepEqual(await pointers(a), { active: 4, pending: null }, "approval makes the revision active");

    v = (await user.post(`/api/orders/${a}/versions/1/restore`).expect(200)).body as OrderView;
    assert.deepEqual(await pointers(a), { active: 5, pending: null }, "a restore is a new active version");
    assert.equal(v.printSeconds, PLATE1_SECONDS);

    const all = await versions(a);
    assert.deepEqual(all.map((x) => [x.n, x.state]), [[1, "approved"], [2, "withdrawn"], [3, "rejected"], [4, "approved"], [5, "approved"]]);
    assert.deepEqual(all[0], v1, "version 1 is exactly as it was after its review");
    assert.deepEqual([all[4].restoredFrom, all[4].fileId], [1, v1.fileId], "the restore reuses version 1's file");
    const d = (await user.get(`/api/orders/${a}`).expect(200)).body as OrderDetail;
    assert.deepEqual(d.versions!.filter((x) => x.current).map((x) => x.n), [5]);
  });

  it("before the first review a new upload replaces the active version; cancelling withdraws what waits for review", async () => {
    const a = await submit();
    await revise(a, x2dPlate1Plus(5)).expect(200);
    assert.deepEqual(await pointers(a), { active: 2, pending: null });
    const v = (await user.get(`/api/orders/${a}`).expect(200)).body as OrderDetail;
    assert.equal(v.revision, null, "nothing approved to compare with");
    assert.equal(v.canWithdraw, false);

    const b = await submit();
    await builder.post(`/api/orders/${b}/approve`).expect(200);
    await revise(b, x2dPlate1Plus(5)).expect(200);
    for (const id of [a, b]) await user.post(`/api/orders/${id}/cancel`).send({ reason: "不打了" }).expect(200);
    assert.deepEqual((await versions(a)).map((x) => x.state), ["withdrawn", "withdrawn"]);
    assert.deepEqual((await versions(b)).map((x) => x.state), ["approved", "withdrawn"]);
    assert.deepEqual(await pointers(b), { active: 1, pending: null }, "a cancelled order shows the version it held");
  });

  it("the database refuses edits, deletes, second decisions and pointers that do not fit", async () => {
    const a = await submit();
    const b = await submit();
    await builder.post(`/api/orders/${a}/approve`).expect(200);
    const [v1] = await versions(a);
    const [w1] = await versions(b);
    const refused = (q: Promise<unknown>, re: RegExp) => assert.rejects(q, (e: Error) => re.test(`${e.message} ${(e.cause as Error | undefined)?.message ?? ""}`));

    await refused(t.db.update(orderVersions).set({ printSeconds: 1 }).where(eq(orderVersions.id, w1.id)), /immutable/);
    await refused(t.db.update(orderVersions).set({ state: "rejected" }).where(eq(orderVersions.id, v1.id)), /already decided/);
    await refused(t.db.delete(orderVersions).where(eq(orderVersions.id, w1.id)), /never deleted/);
    await refused(t.db.update(orders).set({ pendingVersionId: v1.id }).where(eq(orders.id, a)), /orders_pending_in_review/);
    await refused(t.db.update(orders).set({ activeVersionId: v1.id }).where(eq(orders.id, b)), /orders_active_version_own/);
    await refused(t.db.update(orders).set({ activeVersionId: null }).where(eq(orders.id, b)), /no active version/);
    assert.deepEqual((await versions(b))[0], w1);
  });
});

describe("createOrder", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: string;
  let fileId: string;

  before(async () => {
    ({ db, close } = await openDb("memory"));
    [{ id: userId }] = await db.insert(users).values({ username: "u", displayName: "u" }).returning({ id: users.id });
    [{ id: fileId }] = await db.insert(files).values({ sha256: "x", key: "k", fileName: "f.gcode.3mf", sizeBytes: 1, uploadedBy: userId }).returning({ id: files.id });
  });
  after(() => close());

  const values = () => ({ status: "PENDING_REVIEW" as const, ownerId: userId, formVersionId: 1, answers: [], originalPrintSeconds: 600 });

  it("writes the order and its first version together, and an order without one cannot commit", async () => {
    const o = await db.transaction((tx) => createOrder(tx, values(), fields(fileId), { kind: "submit", state: "pending" }));
    assert.equal((await orderRow(db, o.id))!.printSeconds, 600);
    await assert.rejects(db.transaction((tx) => tx.insert(orders).values(values())), (e: Error) => /no active version/.test(`${e.message} ${(e.cause as Error | undefined)?.message ?? ""}`));
  });
});

describe("migration 0007/0008", () => {
  it("points existing orders at the versions they held and drops the copies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "platerelay-mig-"));
    try {
      /* the migrations up to 0006, then data the way the old code left it */
      await cp(MIGRATIONS, dir, { recursive: true });
      const journal = JSON.parse(await readFile(join(dir, "meta/_journal.json"), "utf8"));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 6);
      await writeFile(join(dir, "meta/_journal.json"), JSON.stringify(journal));
      const client = new PGlite();
      const db = drizzle(client);
      try {
        await migrate(db, { migrationsFolder: dir });
        await db.execute(sql`insert into users (id, username, display_name) values ('00000000-0000-7000-8000-000000000001', 'u', 'u')`);
        await db.execute(sql`insert into files (id, sha256, key, file_name, size_bytes, uploaded_by) values
          ('00000000-0000-7000-8000-00000000000a', 'a', 'a', 'a.gcode.3mf', 1, '00000000-0000-7000-8000-000000000001'),
          ('00000000-0000-7000-8000-00000000000b', 'b', 'b', 'b.gcode.3mf', 1, '00000000-0000-7000-8000-000000000001'),
          ('00000000-0000-7000-8000-00000000000c', 'c', 'c', 'c.gcode.3mf', 1, '00000000-0000-7000-8000-000000000001')`);
        const order = (id: number, status: string, file: string, s: number, revision: string | null) => sql`insert into orders
          (id, status, owner_id, file_id, plate_index, plate_count, printer_model_id, nozzles, filaments, print_seconds, weight_grams, form_version_id, answers, queue_seq, revision)
          values (${id}, ${status}::order_status, '00000000-0000-7000-8000-000000000001', ${`00000000-0000-7000-8000-00000000000${file}`}, 1, 1, 'N6', '[]', '[]', ${s}, 1, 1, '[]', ${status === "PENDING_REVIEW" && id !== 3 ? 1 : null}, ${revision}::jsonb)`;
        const version = (order: number, n: number, state: string, file: string, s: number) => sql`insert into order_versions
          (order_id, n, kind, state, file_id, plate_index, plate_count, printer_model_id, nozzles, filaments, print_seconds, weight_grams)
          values (${order}, ${n}, ${n === 1 ? "submit" : "revision"}, ${state}::version_state, ${`00000000-0000-7000-8000-00000000000${file}`}, 1, 1, 'N6', '[]', '[]', ${s}, 1)`;
        const rev = JSON.stringify({ n: 2, kind: "revision", deltaSeconds: 1200, placesBack: 1, recalled: true });
        /* 1: queued · 2: frozen revision · 3: first-review replacement · 4: rejected · 5: rejected revision · 6: cancelled first review · 7: cancelled revision */
        for (const q of [
          order(1, "QUEUED", "a", 100, null), version(1, 1, "approved", "a", 100),
          order(2, "PENDING_REVIEW", "c", 300, rev), version(2, 1, "approved", "a", 100), version(2, 2, "withdrawn", "b", 200), version(2, 3, "pending", "c", 300),
          order(3, "PENDING_REVIEW", "b", 200, rev), version(3, 1, "withdrawn", "a", 100), version(3, 2, "pending", "b", 200),
          order(4, "REJECTED", "a", 100, null), version(4, 1, "rejected", "a", 100),
          order(5, "QUEUED", "a", 100, null), version(5, 1, "approved", "a", 100), version(5, 2, "rejected", "b", 200),
          order(6, "CANCELLED", "a", 100, null), version(6, 1, "pending", "a", 100),
          order(7, "CANCELLED", "c", 300, rev), version(7, 1, "approved", "a", 100), version(7, 2, "pending", "c", 300),
        ]) await db.execute(q);

        await migrate(db, { migrationsFolder: MIGRATIONS });
        const res = await db.execute(sql`select o.id, a.n as active, p.n as pending, a.print_seconds as s, o.original_print_seconds as original, p.decision
          from orders o join order_versions a on a.id = o.active_version_id left join order_versions p on p.id = o.pending_version_id order by o.id`);
        assert.deepEqual(
          res.rows.map((r) => ({ ...r })),
          [
            { id: 1, active: 1, pending: null, s: 100, original: 100, decision: null },
            { id: 2, active: 1, pending: 3, s: 100, original: 100, decision: { deltaSeconds: 1200, placesBack: 1, recalled: true } },
            { id: 3, active: 2, pending: null, s: 200, original: 100, decision: null },
            { id: 4, active: 1, pending: null, s: 100, original: 100, decision: null },
            { id: 5, active: 1, pending: null, s: 100, original: 100, decision: null },
            { id: 6, active: 1, pending: null, s: 100, original: 100, decision: null },
            { id: 7, active: 1, pending: null, s: 100, original: 100, decision: null },
          ],
        );
        const cancelled = await db.execute(sql`select v.state from orders o join order_versions v on v.id = o.active_version_id where o.id in (6, 7) order by o.id`);
        assert.deepEqual(cancelled.rows, [{ state: "withdrawn" }, { state: "approved" }]);
        const withdrawn = await db.execute(sql`select state from order_versions where order_id = 7 and n = 2`);
        assert.deepEqual(withdrawn.rows, [{ state: "withdrawn" }]);
        const cols = await db.execute(sql`select column_name from information_schema.columns where table_name = 'orders' and column_name in ('file_id', 'print_seconds', 'revision')`);
        assert.equal(cols.rows.length, 0, "the copies on orders are gone");
      } finally {
        await client.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
