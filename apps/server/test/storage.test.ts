import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config/config.js";
import { S3Storage } from "../src/storage/s3.storage.js";

/* No network: presigning is local, and nothing here sends a request to the bucket. */
describe("S3 / OSS storage", () => {
  const env = {
    PLATERELAY_SECRET: "x",
    PLATERELAY_STORAGE: "oss",
    OSS_ENDPOINT: "https://oss-cn-beijing.aliyuncs.com",
    OSS_BUCKET: "example-bucket",
    OSS_ACCESS_KEY_ID: "AKIDEXAMPLE",
    OSS_ACCESS_KEY_SECRET: "not-a-real-secret",
  };

  it("reads its settings from the environment only", () => {
    const c = loadConfig(env).storage;
    assert.equal(c.kind, "s3");
    if (c.kind !== "s3") return;
    assert.equal(c.region, "oss-cn-beijing");
    assert.equal(c.forcePathStyle, false);
    assert.throws(() => loadConfig({ ...env, OSS_BUCKET: "" }), /OSS_BUCKET/);
    assert.equal(loadConfig({ PLATERELAY_SECRET: "x" }).storage.kind, "local");
  });

  it("signs short-lived virtual-hosted GET links, on the public endpoint when set", async () => {
    const c = loadConfig({ ...env, OSS_PUBLIC_ENDPOINT: "https://files.example.com" }).storage;
    if (c.kind !== "s3") throw new Error("expected s3");
    const s = new S3Storage(c);
    const u = new URL(await s.signedUrl("plates/abc/1.png", 600, "盘 1.png"));
    assert.equal(u.hostname, "example-bucket.files.example.com");
    assert.equal(u.pathname, "/plates/abc/1.png");
    assert.equal(u.searchParams.get("X-Amz-Expires"), "600");
    assert.match(u.searchParams.get("response-content-disposition")!, /filename\*=UTF-8''/);
    assert.ok(!u.toString().includes("not-a-real-secret"));
    await assert.rejects(s.signedUrl("../etc/passwd", 60), /bad storage key/);
  });
});
