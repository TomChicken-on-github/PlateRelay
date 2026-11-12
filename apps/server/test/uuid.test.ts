import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uuidv7 } from "../src/common/uuid.js";

describe("uuidv7", () => {
  it("has version 7, the RFC variant and the timestamp up front", () => {
    const t = Date.UTC(2026, 9, 25, 2, 20);
    const u = uuidv7(t + 1000);
    assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(parseInt(u.slice(0, 8) + u.slice(9, 13), 16), t + 1000);
  });

  it("keeps increasing within one millisecond", () => {
    const now = Date.now() + 60_000;
    const ids = Array.from({ length: 5000 }, () => uuidv7(now));
    assert.deepEqual([...ids].sort(), ids);
    assert.equal(new Set(ids).size, ids.length);
  });
});
