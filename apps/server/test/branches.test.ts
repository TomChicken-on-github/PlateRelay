import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Client, FakeDaemon, IDLE, startApp, type TestApp, until, x2dPlate1Plus, x2dTwoPlates } from "./helpers.js";

const TRAYS = [
  { unit: 0, slot: 0, material: "PLA", subType: "GFA00", colour: "#FFFF00", extruders: [1] },
  { unit: 0, slot: 1, material: "PETG", subType: "GFG00", colour: "#FFFFFF", extruders: [2] },
];

describe("the ways an order leaves the straight path", () => {
  let t: TestApp;
  let admin: Client;
  let staff: Client;
  let applicant: Client;
  let daemon: FakeDaemon;
  let printerId: string;
  let uploads = 0;

  before(async () => {
    t = await startApp();
    admin = await t.as("ADMIN");
    staff = await t.as("STAFF");
    applicant = await t.as("APPLICANT");
    daemon = await new FakeDaemon(t).enroll();
    await daemon.connect();
    const key = (await admin.get(`/daemons/${daemon.daemonId}/public-key`).expect(200)).body;
    printerId = (await admin.post("/printers", { daemonId: daemon.daemonId, brand: "sim", serial: "SIM-0001", host: "127.0.0.1:7130", name: "Sim 1", accessCodeCipher: "cipher", keyFingerprint: key.keyFingerprint }).expect(201)).body.id;
    await idle();
    await clearBed();
    const p = await printer();
    await admin.put(`/printers/${printerId}/open`, { version: p.version, open: true }).expect(200);
  });
  after(async () => {
    await daemon.close();
    await t.close();
  });

  const printer = async () => (await staff.get(`/printers/${printerId}`).expect(200)).body;
  const order = async (id: string, as: Client = admin) => (await as.get(`/orders/${id}`).expect(200)).body;
  const idle = (extra: object = {}) => daemon.snapshot(printerId, { ...IDLE, trays: TRAYS, ...extra });
  const clearBed = () => staff.post(`/printers/${printerId}/clear-bed`, { expectedState: "CLEARING_REQUIRED" }).expect(200);
  const queue = async () => (await admin.get("/queue").expect(200)).body.map((e: { order: { id: string } }) => e.order.id);

  async function upload(file: Buffer, as: Client = applicant) {
    return (await as.agent.post("/api/v1/files").set("Idempotency-Key", `upload-${++uploads}-00000`).attach("file", file, "part.gcode.3mf").expect(202)).body.fileId as string;
  }

  /** A queued order of plate 1, printing `minutes` longer than the fixture says so each upload is a different file. */
  async function queued(minutes = 0, as: Client = applicant): Promise<string> {
    const fileId = await upload(minutes ? x2dPlate1Plus(minutes) : x2dTwoPlates(), as);
    const form = (await as.get("/form").expect(200)).body;
    const id = (await as.post("/orders", { fileId, plates: [1], colourPref: "SIMILAR", formVersionId: form.versionId, answers: [] }).expect(201)).body.orders[0].id;
    const o = await order(id);
    await admin.post(`/orders/${id}/approve`, { expectedStatus: "PENDING_REVIEW", versionId: o.activeVersion.id }).expect(200);
    return id;
  }

  /** Dispatches to the one printer and returns the job reference and the start command. */
  async function dispatch(orderId: string) {
    const nth = daemon.commands("job.start").length;
    const options = (await staff.get(`/printers/${printerId}/dispatch-options?orderId=${orderId}`).expect(200)).body;
    await staff.post(`/printers/${printerId}/dispatch`, { orderId, expectedStatus: "QUEUED", expectedState: "AVAILABLE", bedType: "textured_plate", bedTypeMismatchConfirmed: true, mapping: options.proposal.map((x: { entry: object }) => x.entry) }).expect(202);
    const start = await daemon.command("job.start", nth);
    return { jobRef: String(start.params.jobRef), commandId: start.commandId };
  }

  it("a start the daemon could not carry out puts the order back in its place and flags the printer", async () => {
    const first = await queued(1);
    const second = await queued(2);
    const { commandId } = await dispatch(first);
    assert.deepEqual(await queue(), [second]);
    await daemon.result(commandId, "failed", { code: "transfer_failed", message: "upload broke" });
    assert.equal((await order(first)).status, "QUEUED");
    assert.deepEqual(await queue(), [first, second], "back to the place it had, not to the end");
    let p = await printer();
    assert.equal(p.state, "ATTENTION");
    assert.deepEqual(p.reasons, ["SEND_FAILED"]);

    /* Releasing never leads straight to available. */
    p = (await staff.post(`/printers/${printerId}/release`, { expectedState: "ATTENTION", reason: "cable was loose" }).expect(200)).body;
    assert.equal(p.state, "CLEARING_REQUIRED");
    await clearBed();
    await admin.post(`/orders/${second}/cancel`, { expectedStatus: "QUEUED", reason: "test over" }).expect(200);
    await applicant.post(`/orders/${first}/cancel`, { expectedStatus: "QUEUED", reason: "test over" }).expect(200);
    assert.deepEqual(await queue(), []);
  });

  it("stopped before the print began: back in the queue; stopped after: failed, and a reprint returns it to its place", async () => {
    const id = await queued(3);
    let job = await dispatch(id);
    await daemon.event(printerId, "job.staged", { jobRef: job.jobRef });

    /* A stop names the job the person was looking at. */
    await staff.post(`/printers/${printerId}/stop`, { expectedState: "WORKING", expectedJobId: "00000000-0000-7000-8000-000000000000", reason: "wrong plate" }).expect(409);
    const stop = (await staff.post(`/printers/${printerId}/stop`, { expectedState: "WORKING", expectedJobId: job.jobRef, reason: "wrong plate" }).expect(202)).body;
    assert.equal((await order(id)).status, "DISPATCHED", "nothing moves until the printer reports it stopped");
    await daemon.event(printerId, "job.cancelled", { jobRef: job.jobRef, data: { commandId: stop.commandId, beforeStart: true } });
    assert.equal((await order(id)).status, "QUEUED");
    assert.equal((await printer()).state, "CLEARING_REQUIRED");
    await clearBed();

    job = await dispatch(id);
    await daemon.event(printerId, "job.staged", { jobRef: job.jobRef });
    await daemon.event(printerId, "job.started", { jobRef: job.jobRef });
    await daemon.snapshot(printerId, { ...IDLE, trays: TRAYS, state: "PRINTING", job: { jobRef: job.jobRef, external: false, percent: 50 } });
    await daemon.event(printerId, "job.failed", { jobRef: job.jobRef, data: { reason: "nozzle clog", beforeStart: false } });
    let o = await order(id);
    assert.equal(o.status, "FAILED");
    assert.deepEqual(o.printJobs.map((j: { outcome: string }) => j.outcome), ["FAILED", "STOPPED_BEFORE_START"]);
    const p = await printer();
    assert.equal(p.trays[0].remainingGrams, 1000 - 56, "half of the planned 111 g was used");

    await applicant.post(`/orders/${id}/reprint`, { expectedStatus: "FAILED" }).expect(403);
    o = (await staff.post(`/orders/${id}/reprint`, { expectedStatus: "FAILED" }).expect(200)).body;
    assert.equal(o.status, "QUEUED");
    assert.equal((await printer()).state, "CLEARING_REQUIRED", "the bed still has the failed print on it");
    await clearBed();
    await admin.post(`/orders/${id}/cancel`, { expectedStatus: "QUEUED", reason: "test over" }).expect(200);
  });

  it("a revision is reviewed again, keeps its place meanwhile, and moves back when it prints much longer", async () => {
    const first = await queued(4);
    const second = await queued(5);
    const third = await queued(6);

    /* 60 minutes longer than the version approved before: 15 are free, the other 45 cost one place per started 15 minutes. */
    const fileId = await upload(x2dPlate1Plus(64));
    let o = (await applicant.post(`/orders/${first}/versions`, { expectedStatus: "QUEUED", fileId, plate: 1 }).expect(201)).body;
    assert.equal(o.status, "PENDING_REVIEW");
    assert.equal(o.frozen, true);
    assert.equal(o.pendingVersion.placesBack, 3);
    assert.deepEqual(await queue(), [first, second, third], "holds its place while the revision waits");
    assert.deepEqual((await staff.get("/queue/suggestions").expect(200)).body, [{ printerId, orderId: second }], "but cannot be dispatched");

    o = (await admin.post(`/orders/${first}/approve`, { expectedStatus: "PENDING_REVIEW", versionId: o.pendingVersion.id }).expect(200)).body;
    assert.equal(o.activeVersion.n, 2);
    assert.equal(o.revisions.used, 1);
    assert.deepEqual(await queue(), [second, third, first], "fewer than three behind it: to the end");

    /* A rejected revision leaves the order as it was. */
    const again = await upload(x2dPlate1Plus(7));
    o = (await applicant.post(`/orders/${second}/versions`, { expectedStatus: "QUEUED", fileId: again, plate: 1 }).expect(201)).body;
    o = (await admin.post(`/orders/${second}/reject`, { expectedStatus: "PENDING_REVIEW", versionId: o.pendingVersion.id, reason: "supports missing" }).expect(200)).body;
    assert.equal(o.status, "QUEUED");
    assert.equal(o.activeVersion.n, 1);
    assert.deepEqual(await queue(), [second, third, first]);

    for (const id of [first, second, third]) await admin.post(`/orders/${id}/cancel`, { expectedStatus: "QUEUED", reason: "test over" }).expect(200);
  });

  it("when contact is lost mid-print and the printer comes back idle, a person says what happened", async () => {
    const id = await queued(8);
    const job = await dispatch(id);
    await daemon.event(printerId, "job.staged", { jobRef: job.jobRef });
    await daemon.event(printerId, "job.started", { jobRef: job.jobRef });
    await daemon.close();
    await until("unreachable", async () => (await printer()).reasons.includes("OFFLINE"));
    assert.equal((await order(id)).status, "PRINTING", "losing contact changes nothing about the order");

    await daemon.connect();
    await idle();
    let p = await printer();
    assert.deepEqual(p.reasons, ["JUDGE"]);
    assert.equal((await order(id)).status, "PRINTING", "the panel does not guess");

    await staff.post(`/orders/${id}/reconcile`, { expectedStatus: "PRINTING", outcome: "PRINTED", note: "it is on the bed, complete" }).expect(200);
    assert.equal((await order(id)).status, "PRINTED");
    p = await printer();
    assert.equal(p.state, "CLEARING_REQUIRED");
    assert.deepEqual(p.reasons, []);
  });

  it("a print someone started at the machine is shown, touches no order, and still ends with clearing the bed", async () => {
    /* The previous test left a finished print to store; dispose of it the long way round is not needed here: the bed is confirmed after storing. */
    const todo = (await staff.get("/todo").expect(200)).body;
    assert.ok(todo.some((x: { kind: string }) => x.kind === "STORE"));
    await daemon.event(printerId, "external.started", { data: { name: "benchy.gcode" } });
    let p = await printer();
    assert.equal(p.state, "WORKING");
    assert.equal(p.job.external, true);
    await daemon.event(printerId, "external.ended", { data: { result: "finished" } });
    p = await printer();
    assert.equal(p.state, "CLEARING_REQUIRED");
  });
});
