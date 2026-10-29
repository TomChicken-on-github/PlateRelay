import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Agent } from "supertest";
import { eq } from "drizzle-orm";
import { files, printers, orders, orderVersions } from "../src/db/schema.js";
import { type ObjectStorage, STORAGE } from "../src/storage/storage.js";
import { startApp, type TestApp, x2dPlate1Plus, x2dTwoPlates } from "./helpers.js";

describe("revision storage compensation", () => {
  let t: TestApp;
  let user: Agent;
  let builder: Agent;
  let storage: ObjectStorage;
  let signedUrl: ObjectStorage["signedUrl"];
  let printerId: string;

  before(async () => {
    t = await startApp();
    ({ agent: user } = await t.as("user"));
    ({ agent: builder } = await t.as("builder"));
    storage = t.app.get(STORAGE);
    signedUrl = storage.signedUrl.bind(storage);
    const created = await builder.post("/api/printers").send({ name: "Storage-X2D", ip: "192.0.2.30", serial: "STORAGEX2D001" }).expect(201);
    printerId = created.body.id;
    await t.db.update(printers).set({ openToContestants: true, model: "Bambu Lab X2D", modelId: "N6", nozzles: [{ extruder: 1, diameter: 0.4 }, { extruder: 2, diameter: 0.4 }], storage: [{ medium: "internal", present: true, writable: true }], state: "MAINTENANCE" }).where(eq(printers.id, printerId));
  });

  after(async () => {
    storage.signedUrl = signedUrl;
    await t.close();
  });

  it("does not delete files after the revision transaction commits and the response view fails", async () => {
    const submitted = await user.post("/api/orders").attach("file", x2dTwoPlates(), "original.gcode.3mf").field("answers", JSON.stringify({ reason: "test" })).field("plates", "[1]").expect(201);
    const id = submitted.body.orders[0].id as number;
    await builder.post(`/api/orders/${id}/approve`).expect(200);

    storage.signedUrl = async () => { throw new Error("simulated URL signing outage"); };
    const response = await user.post(`/api/orders/${id}/revise`).attach("file", x2dPlate1Plus(5), "revised.gcode.3mf");
    assert.equal(response.status, 500);
    storage.signedUrl = signedUrl;

    const [order] = await t.db.select().from(orders).where(eq(orders.id, id));
    const [version] = await t.db.select().from(orderVersions).where(eq(orderVersions.id, order.pendingVersionId!));
    const [file] = await t.db.select().from(files).where(eq(files.id, version.fileId));
    assert.equal(file.fileName, "revised.gcode.3mf");
    assert.equal(await storage.exists(file.key), true);
    assert.equal(await storage.exists(version.thumbnailKey!), true);
    assert.equal(await storage.exists(version.partsTopKey!), true);
    assert.equal(await storage.exists(version.partsPickKey!), true);
  });
});
