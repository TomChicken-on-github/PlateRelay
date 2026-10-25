import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { openDb } from "../src/db/db.js";

describe("embedded database lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "platerelay-lock-"));
  after(() => rm(root, { recursive: true, force: true }));

  it("refuses a second open of the same directory until the first closes", async () => {
    const dir = join(root, "pglite");
    const first = await openDb(dir);
    await assert.rejects(openDb(dir), /in use by process/);
    await first.close();
    const second = await openDb(dir);
    await second.close();
  });

  it("takes over a lock left by a process that has exited", async () => {
    const dir = join(root, "stale");
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeFile(`${dir}.lock`, String(dead));
    const handle = await openDb(dir);
    await handle.close();
  });
});
