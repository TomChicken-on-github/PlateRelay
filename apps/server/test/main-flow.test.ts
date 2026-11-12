import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { type Client, FakeDaemon, IDLE, JPEG, startApp, type TestApp, until, x2dTwoPlates } from "./helpers.js";

const TRAYS = [
  { unit: 0, slot: 0, material: "PLA", subType: "GFA00", colour: "#FFFF00", extruders: [1] },
  { unit: 0, slot: 1, material: "PETG", subType: "GFG00", colour: "#FFFFFF", extruders: [2] },
];

describe("an order from submission to pickup, with a daemon on the other end", () => {
  let t: TestApp;
  let admin: Client;
  let staff: Client;
  let applicant: Client;
  let daemon: FakeDaemon;
  let printerId: string;
  let orderId: string;
  let jobRef: string;

  before(async () => {
    t = await startApp();
    admin = await t.as("ADMIN");
    staff = await t.as("STAFF");
    applicant = await t.as("APPLICANT", "Applicant A");
    daemon = await new FakeDaemon(t).enroll();
    await daemon.connect();
  });
  after(async () => {
    await daemon.close();
    await t.close();
  });

  const printer = async () => (await staff.get(`/printers/${printerId}`).expect(200)).body;
  const order = async (as: Client = staff) => (await as.get(`/orders/${orderId}`).expect(200)).body;

  it("refuses a write without an Idempotency-Key and replays one that is repeated", async () => {
    await applicant.agent.post("/api/v1/orders").send({}).expect(428);
    const key = "0123456789abcdef";
    const body = { name: "bench-2" };
    const first = await admin.agent.post("/api/v1/daemons/enrollments").set("Idempotency-Key", key).send(body).expect(201);
    const again = await admin.agent.post("/api/v1/daemons/enrollments").set("Idempotency-Key", key).send(body).expect(201);
    assert.equal(again.headers["idempotent-replayed"], "true");
    assert.deepEqual(again.body, first.body);
    await admin.agent.post("/api/v1/daemons/enrollments").set("Idempotency-Key", key).send({ name: "other" }).expect(409);
  });

  it("answers refusals as problem documents and hides what the caller may not see", async () => {
    const res = await applicant.get("/printers").expect(403);
    assert.match(res.headers["content-type"], /application\/problem\+json/);
    assert.equal(res.body.code, "forbidden");
    assert.equal(res.body.requestId, res.headers["x-request-id"]);
    await request(t.app.getHttpServer()).get("/api/v1/me").expect(401);
  });

  it("registers a printer, which stays unreachable until its daemon reports it, and then needs its bed confirmed", async () => {
    const key = (await admin.get(`/daemons/${daemon.daemonId}/public-key`).expect(200)).body;
    const created = await admin.post("/printers", { daemonId: daemon.daemonId, brand: "sim", serial: "SIM-0001", host: "127.0.0.1:7130", name: "Sim 1", accessCodeCipher: "cipher", keyFingerprint: key.keyFingerprint }).expect(201);
    printerId = created.body.id;
    assert.equal(created.body.state, "ATTENTION");
    assert.deepEqual(created.body.reasons, ["OFFLINE"]);
    const assign = (await until("printers.assign", () => daemon.received.find((f) => f.type === "printers.assign"))) as { body: { printers: { printerId: string; accessCodeCipher: string }[] } };
    assert.equal(assign.body.printers[0].printerId, printerId);

    await daemon.snapshot(printerId, { ...IDLE, trays: TRAYS });
    let p = await printer();
    assert.equal(p.state, "CLEARING_REQUIRED", "a printer never becomes available without someone looking at the bed");
    assert.equal(p.modelId, "N6");
    assert.equal(p.trays.length, 2);

    await staff.post(`/printers/${printerId}/clear-bed`, { expectedState: "CLEARING_REQUIRED" }).expect(200);
    p = (await admin.put(`/printers/${printerId}/open`, { version: p.version, open: true }).expect(200)).body;
    assert.equal(p.state, "AVAILABLE");
    assert.equal(p.openToApplicants, true);
  });

  it("takes an upload, a submission and a review", async () => {
    const check = (await applicant.agent.post("/api/v1/files").set("Idempotency-Key", "upload-000001").attach("file", x2dTwoPlates(), "two plates.gcode.3mf").expect(202)).body;
    assert.equal(check.verdict, "PASS");
    assert.equal(check.plates.length, 2);
    assert.equal(check.plates[0].submittable, true);
    const form = (await applicant.get("/form").expect(200)).body;
    const submitted = await applicant.post("/orders", { fileId: check.fileId, plates: [1], colourPref: "SIMILAR", formVersionId: form.versionId, answers: [] }).expect(201);
    orderId = submitted.body.orders[0].id;
    assert.equal(submitted.body.orders[0].status, "PENDING_REVIEW");

    const other = await t.as("APPLICANT");
    await other.get(`/orders/${orderId}`).expect(404);

    const pending = await order(admin);
    assert.ok(pending.actions.includes("approveOrder"));
    const approved = (await admin.post(`/orders/${orderId}/approve`, { expectedStatus: "PENDING_REVIEW", versionId: pending.activeVersion.id }).expect(200)).body;
    assert.equal(approved.status, "QUEUED");
    assert.deepEqual(approved.queue, { position: 1, ahead: 0, wait: null });
    await admin.post(`/orders/${orderId}/approve`, { expectedStatus: "PENDING_REVIEW", versionId: pending.activeVersion.id }).expect(409);
  });

  it("dispatches with a mapping the system proposes, and moves order and printer together", async () => {
    assert.deepEqual((await staff.get("/queue/suggestions").expect(200)).body, [{ printerId, orderId }]);
    const options = (await staff.get(`/printers/${printerId}/dispatch-options?orderId=${orderId}`).expect(200)).body;
    assert.equal(options.feasible, true);
    assert.deepEqual(
      options.proposal.map((x: { entry: { sliceSlot: number; tray: object } }) => [x.entry.sliceSlot, x.entry.tray]),
      [
        [1, { unit: 0, slot: 0 }],
        [2, { unit: 0, slot: 1 }],
      ],
    );
    const mapping = options.proposal.map((x: { entry: object }) => x.entry);

    /* Two filaments on one tray is a physical impossibility: refused, whatever reason is given. */
    const bad = await staff.post(`/printers/${printerId}/dispatch`, { orderId, expectedStatus: "QUEUED", expectedState: "AVAILABLE", bedType: "textured_plate", bedTypeMismatchConfirmed: true, mapping: mapping.map((m: object) => ({ ...m, tray: { unit: 0, slot: 0 }, mismatchReason: "x" })) }).expect(422);
    assert.equal(bad.body.code, "mapping_blocked");

    const accepted = await staff.post(`/printers/${printerId}/dispatch`, { orderId, expectedStatus: "QUEUED", expectedState: "AVAILABLE", bedType: "textured_plate", bedTypeMismatchConfirmed: true, mapping }).expect(202);
    const start = await daemon.command("job.start");
    assert.equal(start.commandId, accepted.body.commandId);
    jobRef = String(start.params.jobRef);
    assert.equal((start.params.mapping as unknown[]).length, 2);

    const o = await order();
    assert.equal(o.status, "DISPATCHED");
    const p = await printer();
    assert.equal(p.state, "WORKING");
    assert.equal(p.job.jobId, jobRef);
    assert.equal(p.job.phase, "TRANSFERRING");

    /* The applicant can no longer cancel; the printer cannot take a second order. */
    assert.equal((await applicant.post(`/orders/${orderId}/cancel`, { expectedStatus: "DISPATCHED", reason: "changed my mind" }).expect(422)).body.params.rule, "dispatched");
    await staff.post(`/printers/${printerId}/dispatch`, { orderId, expectedStatus: "QUEUED", expectedState: "AVAILABLE", mapping }).expect(409);
  });

  it("lets the daemon fetch the job's file, and nobody else", async () => {
    const start = daemon.commands("job.start")[0];
    const file = start.params.file as { fileId: string; sizeBytes: number };
    const http = request(t.app.getHttpServer());
    await http.get(`/daemon/v1/files/${file.fileId}?jobRef=${jobRef}`).expect(401);
    const res = await http.get(`/daemon/v1/files/${file.fileId}?jobRef=${jobRef}`).set("Authorization", `Bearer ${daemon.httpToken}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(res.status, 200);
    assert.equal((res.body as Buffer).length, file.sizeBytes);
  });

  it("follows what the printer reports: preparing, printing, paused by an error, resumed, finished", async () => {
    await daemon.result(daemon.commands("job.start")[0].commandId, "accepted", { data: { step: "upload" } });
    await daemon.event(printerId, "job.staged", { jobRef });
    assert.equal((await printer()).job.phase, "PREPARING");
    assert.equal((await order()).status, "DISPATCHED", "only the printer's own report of the start makes it printing");

    await daemon.snapshot(printerId, { ...IDLE, trays: TRAYS, state: "PREPARING", job: { jobRef, external: false, percent: 0 } });
    await daemon.event(printerId, "job.started", { jobRef });
    assert.equal((await order()).status, "PRINTING");

    await daemon.event(printerId, "job.paused", { jobRef, data: { reason: "ERROR" } });
    let p = await printer();
    assert.equal(p.state, "ATTENTION");
    assert.deepEqual(p.reasons, ["ERROR"]);
    assert.equal(p.pauseReason, "ERROR");
    await daemon.event(printerId, "job.resumed", { jobRef });
    assert.equal((await printer()).state, "WORKING");

    await daemon.snapshot(printerId, { ...IDLE, trays: TRAYS, state: "PRINTING", job: { jobRef, external: false, percent: 80, remainingSeconds: 600 } });
    assert.deepEqual((await order(applicant)).progress, { percent: 80, remainingSeconds: 600 });

    await daemon.event(printerId, "job.finished", { jobRef });
    /* The same report again, as after a reconnect: applied once. */
    await daemon.event(printerId, "job.finished", { jobRef });
    assert.equal((await order()).status, "PRINTED");
    p = await printer();
    assert.equal(p.state, "CLEARING_REQUIRED");
    assert.equal(p.trays[0].remainingGrams, 1000 - 111, "the gram count goes down by what the slicer planned");
  });

  it("stores the print, which frees the printer in the same step", async () => {
    await http(staff).post(`/api/v1/printers/${printerId}/clear-bed`).set("Idempotency-Key", "clear-bed-0001").send({ expectedState: "CLEARING_REQUIRED" }).expect(422);
    const stored = await staff.agent.post(`/api/v1/orders/${orderId}/store`).set("Idempotency-Key", "store-00000001").field("expectedStatus", "PRINTED").field("slot", "A-12").field("bedCleared", "true").attach("photo", JPEG, { filename: "shelf.jpg", contentType: "image/jpeg" }).expect(200);
    assert.equal(stored.body.status, "READY");
    assert.equal(stored.body.storage.slot, "A-12");
    assert.equal((await printer()).state, "AVAILABLE");
  });

  it("hands the print out against a pickup code, once", async () => {
    await staff.post(`/orders/${orderId}/pickup-code`, { expectedStatus: "READY" }).expect(404);
    const first = (await applicant.post(`/orders/${orderId}/pickup-code`, { expectedStatus: "READY" }).expect(201)).body;
    const second = (await applicant.post(`/orders/${orderId}/pickup-code`, { expectedStatus: "READY" }).expect(201)).body;
    assert.match(second.code, /^PR1-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    await staff.get(`/pickup/${first.code}`).expect(404);
    const found = (await staff.get(`/pickup/${second.code.toLowerCase().replaceAll("-", "")}`).expect(200)).body;
    assert.equal(found.storageSlot, "A-12");
    assert.equal((await staff.post(`/pickup/${second.code}/redeem`, { expectedStatus: "READY" }).expect(200)).body.status, "COMPLETED");
    await staff.post(`/pickup/${second.code}/redeem`, { expectedStatus: "READY" }).expect(404);

    const kinds = (await applicant.get(`/orders/${orderId}/records`).expect(200)).body.map((r: { kind: string }) => r.kind);
    assert.deepEqual(kinds, ["order.submitted", "order.approved", "dispatch.created", "print.started", "print.paused", "print.resumed", "print.finished", "order.stored", "pickup.code_issued", "pickup.code_issued", "order.redeemed"]);
  });

  it("marks the printers unreachable when the daemon goes away, and refuses commands meanwhile", async () => {
    await daemon.close();
    await until("printer unreachable", async () => (await printer()).reasons.includes("OFFLINE"));
    assert.equal((await staff.post(`/printers/${printerId}/refresh`, {}).expect(409)).body.code, "printer_unreachable");
    await daemon.connect();
    await daemon.snapshot(printerId, { ...IDLE, trays: TRAYS });
    assert.equal((await printer()).state, "CLEARING_REQUIRED", "after losing contact nobody knows what is on the bed");
  });

  it("refuses a daemon that signs for another panel", async () => {
    const stranger = await new FakeDaemon(t).enroll("stranger");
    await stranger.connect({ origin: "http://other-panel.test" });
    await until("closed", () => stranger.closeCode !== null);
    assert.equal(stranger.closeCode, 4401);
  });
});

const http = (c: Client) => c.agent;
