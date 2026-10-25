import assert from "node:assert/strict";
import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { type DaemonKeyView, encryptAccessCode, type PrinterView } from "@platerelay/shared";
import { auditLog } from "../src/db/schema.js";
import { DaemonsService } from "../src/daemons/daemons.service.js";
import { PrintersService } from "../src/printers/printers.service.js";
import { startApp, type TestApp } from "./helpers.js";

type Agent = Awaited<ReturnType<TestApp["as"]>>["agent"];

const code = (c: string) => (e: unknown) => (e as { getResponse(): { code: string } }).getResponse().code === c;

const keyPair = (bits = 3072) => {
  const k = generateKeyPairSync("rsa", { modulusLength: bits });
  return { pub: k.publicKey.export({ type: "spki", format: "der" }).toString("base64"), priv: k.privateKey };
};

describe("printer access codes", () => {
  let t: TestApp;
  let builder: Agent, staff: Agent;
  let daemons: DaemonsService, printers: PrintersService;
  let daemonId: string;
  const daemon = keyPair();

  const keys = async () => (await builder.get("/api/daemon-keys").expect(200)).body as DaemonKeyView[];
  const encrypt = async (serial: string, code: string) => {
    const k = (await keys()).find((d) => d.id === daemonId)!;
    return encryptAccessCode({ keyId: k.keyId!, publicKey: k.publicKey! }, serial, code);
  };

  before(async () => {
    t = await startApp();
    ({ agent: builder } = await t.as("builder", "赵乐"));
    ({ agent: staff } = await t.as("staff", "陈一帆"));
    daemons = t.app.get(DaemonsService);
    printers = t.app.get(PrintersService);
    daemonId = (await builder.post("/api/daemons").send({ name: "前台电脑" }).expect(201)).body.id;
  });
  after(() => t.close());

  it("lists daemons for the printer form, without a key until the daemon reports one", async () => {
    assert.deepEqual((await keys()).map((d) => [d.name, d.keyId, d.publicKey]), [["前台电脑", null, null]]);
    await staff.get("/api/daemon-keys").expect(403);
  });

  it("only takes RSA keys of 2048 bits or more", async () => {
    await assert.rejects(daemons.setPublicKey(daemonId, keyPair(1024).pub), code("invalid-key"));
    await assert.rejects(daemons.setPublicKey(daemonId, "bm90IGEga2V5"), code("invalid-key"));
  });

  it("needs a daemon with a key before a code can be stored", async () => {
    const fake = { keyId: "0123456789abcdef", ciphertext: "AAAA" };
    const body = { name: "X2D-01", ip: "192.0.2.10", serial: "SNX2D010001", accessCode: fake };
    assert.equal((await builder.post("/api/printers").send(body).expect(400)).body.code, "daemon-required");
    assert.equal((await builder.post("/api/printers").send({ ...body, daemonId }).expect(409)).body.code, "daemon-key-changed");
  });

  let printer: PrinterView;
  it("stores the ciphertext and never hands it back", async () => {
    const { keyId, changed } = await daemons.setPublicKey(daemonId, daemon.pub);
    assert.ok(changed);
    assert.equal((await daemons.setPublicKey(daemonId, daemon.pub)).changed, false);
    assert.equal((await keys())[0].keyId, keyId);

    const accessCode = await encrypt("SNX2D010001", "12345678");
    const res = await builder.post("/api/printers").send({ name: "X2D-01", ip: "192.0.2.10", serial: "SNX2D010001", daemonId, accessCode }).expect(201);
    printer = res.body;
    assert.equal(printer.accessCode?.current, true);
    assert.equal(printer.accessCode?.delivered, false);

    const everywhere = JSON.stringify([res.body, (await builder.get("/api/printers").expect(200)).body, (await builder.get(`/api/printers/${printer.id}`).expect(200)).body, await t.db.select().from(auditLog)]);
    assert.ok(!everywhere.includes(accessCode.ciphertext), "ciphertext in a response or the audit log");
    assert.ok(!everywhere.includes("12345678"));
    assert.equal(((await staff.get("/api/printers").expect(200)).body as PrinterView[])[0].accessCode, null);
  });

  it("refuses a code for an old key or of the wrong length", async () => {
    const good = await encrypt("SNX2D010001", "12345678");
    assert.equal((await builder.patch(`/api/printers/${printer.id}`).send({ accessCode: { ...good, keyId: "ffffffffffffffff" } }).expect(409)).body.code, "daemon-key-changed");
    assert.equal((await builder.patch(`/api/printers/${printer.id}`).send({ accessCode: { ...good, ciphertext: "AAAA" } }).expect(400)).body.code, "invalid-access-code");
  });

  it("gives the daemon what it can decrypt, bound to the serial", async () => {
    const [c] = await printers.accessCodesFor(daemonId);
    assert.equal(c.printerId, printer.id);
    const plain = JSON.parse(privateDecrypt({ key: daemon.priv, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(c.ciphertext, "base64")).toString("utf8"));
    assert.deepEqual(plain, { v: 1, serial: "SNX2D010001", code: "12345678" });

    await printers.markAccessCodeDelivered(daemonId, printer.id);
    assert.equal((await builder.get(`/api/printers/${printer.id}`).expect(200)).body.accessCode.delivered, true);
  });

  it("marks codes stale when the daemon makes a new key", async () => {
    await daemons.setPublicKey(daemonId, keyPair().pub);
    assert.equal((await builder.get(`/api/printers/${printer.id}`).expect(200)).body.accessCode.current, false);
    assert.deepEqual(await printers.accessCodesFor(daemonId), []);

    const fresh = await encrypt("SNX2D010001", "87654321");
    const p = (await builder.patch(`/api/printers/${printer.id}`).send({ accessCode: fresh }).expect(200)).body as PrinterView;
    assert.deepEqual([p.accessCode?.current, p.accessCode?.delivered], [true, false]);
  });

  it("drops the code when the serial or the daemon changes, or on request", async () => {
    await builder.patch(`/api/printers/${printer.id}`).send({ name: "X2D-一号" }).expect(200);
    assert.ok((await builder.get(`/api/printers/${printer.id}`).expect(200)).body.accessCode);

    assert.equal((await builder.patch(`/api/printers/${printer.id}`).send({ serial: "SNX2D010002" }).expect(200)).body.accessCode, null);

    const again = await encrypt("SNX2D010002", "11112222");
    await builder.patch(`/api/printers/${printer.id}`).send({ accessCode: again }).expect(200);
    assert.equal((await builder.patch(`/api/printers/${printer.id}`).send({ daemonId: null }).expect(200)).body.accessCode, null);

    await builder.patch(`/api/printers/${printer.id}`).send({ daemonId, accessCode: again }).expect(200);
    assert.equal((await builder.patch(`/api/printers/${printer.id}`).send({ accessCode: null }).expect(200)).body.accessCode, null);
    assert.equal((await builder.patch(`/api/printers/${printer.id}`).send({ daemonId: "0190a3c4-0000-7000-8000-000000000000" }).expect(400)).body.code, "daemon-not-found");
  });
});
