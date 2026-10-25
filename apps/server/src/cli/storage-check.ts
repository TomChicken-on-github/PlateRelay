import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../config/config.js";
import { S3Storage } from "../storage/s3.storage.js";

/*
 * One-off check of the configured S3/OSS backend: put, exists, signed GET,
 * delete — five requests in total, nothing repeated.
 *   pnpm --filter @platerelay/server storage:check
 */
async function main() {
  const c = loadConfig().storage;
  if (c.kind !== "s3") throw new Error("set PLATERELAY_STORAGE=oss first");
  const s = new S3Storage(c);
  const key = `healthcheck/${randomUUID()}.txt`;
  const body = new TextEncoder().encode("platerelay storage check\n");
  await s.put(key, body, "text/plain");
  console.log("put ok", key);
  console.log("exists", await s.exists(key));
  const url = await s.signedUrl(key, 60);
  const res = await fetch(url);
  console.log("signed GET", res.status, (await res.text()) === "platerelay storage check\n" ? "content ok" : "content differs");
  await s.delete(key);
  console.log("deleted, exists now", await s.exists(key));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
