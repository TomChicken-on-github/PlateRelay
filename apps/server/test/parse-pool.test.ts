import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Gcode3mfError } from "@platerelay/shared";
import { ParseBusy, ParsePool, ParseTimeout } from "../src/gcode3mf/parse-pool.js";
import { x2dTwoPlates } from "./helpers.js";

const opts = { workers: 1, maxQueue: 1, timeoutMs: 10_000, heapMb: 128 };

describe("ParsePool", () => {
  it("parses in a worker and returns the file hash; the caller keeps its buffer", async () => {
    const pool = new ParsePool(opts);
    try {
      const file = x2dTwoPlates();
      const r = await pool.parse("a.gcode.3mf", file);
      assert.deepEqual(r.plates.map((p) => p.index), [1, 2]);
      assert.equal(r.sha256, createHash("sha256").update(file).digest("hex"));
      assert.equal(file.byteLength > 0, true, "the caller's buffer is not moved away");
    } finally {
      await pool.close();
    }
  });

  it("passes a bad file's error code through", async () => {
    const pool = new ParsePool(opts);
    try {
      await assert.rejects(pool.parse("x.gcode.3mf", new Uint8Array([1, 2, 3])), (e) => e instanceof Gcode3mfError);
    } finally {
      await pool.close();
    }
  });

  it("refuses at once when every worker is busy and the queue is full", async () => {
    const pool = new ParsePool(opts);
    try {
      const file = x2dTwoPlates();
      const running = pool.parse("1.gcode.3mf", file);
      const queued = pool.parse("2.gcode.3mf", file);
      await assert.rejects(pool.parse("3.gcode.3mf", file), (e) => e instanceof ParseBusy);
      await Promise.all([running, queued]);
    } finally {
      await pool.close();
    }
  });

  it("kills a parse that runs too long and keeps working with a new worker", async () => {
    const pool = new ParsePool({ ...opts, timeoutMs: 1 });
    try {
      await assert.rejects(pool.parse("slow.gcode.3mf", x2dTwoPlates()), (e) => e instanceof ParseTimeout);
      (pool as unknown as { opts: typeof opts }).opts.timeoutMs = 10_000;
      const r = await pool.parse("next.gcode.3mf", x2dTwoPlates());
      assert.equal(r.plates.length, 2);
    } finally {
      await pool.close();
    }
  });

  it("fails waiting parses on close", async () => {
    const pool = new ParsePool(opts);
    const file = x2dTwoPlates();
    const running = assert.rejects(pool.parse("1.gcode.3mf", file), /closed/);
    const queued = assert.rejects(pool.parse("2.gcode.3mf", file), /closed/);
    await pool.close();
    await Promise.all([running, queued]);
    await assert.rejects(pool.parse("3.gcode.3mf", file), /closed/);
  });
});
