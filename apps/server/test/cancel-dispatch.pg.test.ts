import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { orders, printers } from "../src/db/schema.js";
import { startApp, type TestApp, x2dTwoPlates } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];
const databaseUrl = process.env.PLATERELAY_TEST_DATABASE_URL;

/*
 * A submitter cancels a queued order while Staff dispatch it. The cancel reads the order, then a dispatch
 * commits before the cancel takes its lock. The cancel must then see a dispatched job: it takes the job
 * back from the printer, never leaves the printer holding a cancelled order.
 */
describe("cancel racing a dispatch (PostgreSQL)", { skip: !databaseUrl && "requires PostgreSQL to exercise concurrent transactions" }, () => {
  let t: TestApp;
  let user: Agent;
  let builder: Agent;
  let pool: Pool;
  let printerId: string;

  before(async () => {
    t = await startApp();
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    ({ agent: user } = await t.as("user"));
    ({ agent: builder } = await t.as("builder"));
    printerId = (await builder.post("/api/printers").send({ name: "Cancel-Race-X2D", ip: "192.0.2.41", serial: "CANCELRACE01" }).expect(201)).body.id;
    await t.db.update(printers).set({ openToContestants: true, model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "IDLE" }).where(eq(printers.id, printerId));
  });

  after(async () => {
    await pool?.end();
    await t?.close();
  });

  it("recalls the job the cancel did not see coming", { timeout: 20_000 }, async () => {
    const id = (await user.post("/api/orders").attach("file", x2dTwoPlates(), "race.gcode.3mf").field("answers", JSON.stringify({ reason: "test" })).field("plates", "[1]").expect(201)).body.orders[0].id as number;
    await builder.post(`/api/orders/${id}/approve`).expect(200);

    /* hold the order row so the cancel stops at its lock, after it has read the order as QUEUED */
    const holder = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("select id from orders where id = $1 for update", [id]);
      t.commands.online = true;
      t.commands.sent = [];
      const cancel = user.post(`/api/orders/${id}/cancel`).send({ reason: "不要了" }).then((r) => r);
      /* wait until the cancel is blocked on a lock */
      for (let i = 0; ; i++) {
        const { rows } = await holder.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()");
        if (rows[0].n > 0) break;
        assert.ok(i < 100, "the cancel never reached the order lock");
        await sleep(50);
      }
      /* what a dispatch commits: the order on the printer, the printer preparing */
      await holder.query("update orders set status = 'PRINTING', printer_id = $2, started_at = now() where id = $1", [id, printerId]);
      await holder.query("update printers set state = 'PREPARING', current_order_id = $1, state_since = now() where id = $2", [id, printerId]);
      await holder.query("commit");
      const res = await cancel;
      assert.equal(res.status, 200, JSON.stringify(res.body));
    } finally {
      holder.release();
      t.commands.online = false;
    }

    const [o] = await t.db.select().from(orders).where(eq(orders.id, id));
    const [p] = await t.db.select().from(printers).where(eq(printers.id, printerId));
    assert.equal(o.status, "CANCELLED");
    assert.deepEqual([p.state, p.currentOrderId], ["IDLE", null], "the printer must not keep a cancelled job");
    assert.ok(t.commands.sent.some((c) => c.cmd === "recall" && c.arg === id), "the job is taken back from the printer");
  });
});
