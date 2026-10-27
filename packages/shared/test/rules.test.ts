import { describe, expect, it } from "vitest";
import { DEFAULT_QUEUE_RULES, revisionPlacesBack, waitBucket } from "../src/index.js";

const r = DEFAULT_QUEUE_RULES.revisions;
const min = (m: number) => m * 60;

describe("revisionPlacesBack", () => {
  it("keeps the place up to 15 minutes more, then one place per 15 minutes started", () => {
    expect([-30, 0, 15, 15.5, 16, 30, 31, 45, 46].map((m) => revisionPlacesBack(r, min(m)))).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 3]);
  });

  it("follows the other penalty settings", () => {
    expect(revisionPlacesBack({ ...r, penalty: "none" }, min(300))).toBe(0);
    expect(revisionPlacesBack({ ...r, penalty: "fixed", places: 2 }, min(300))).toBe(2);
    expect(revisionPlacesBack({ ...r, penalty: "tail" }, min(16))).toBe("tail");
    expect(revisionPlacesBack({ ...r, penalty: "tail" }, min(15))).toBe(0);
    expect(revisionPlacesBack({ ...r, thresholdMinutes: 0, stepMinutes: 10, places: 2 }, min(25))).toBe(6);
  });
});

describe("waitBucket", () => {
  it("only gives ranges", () => {
    expect([0, 29, 30, 59, 60, 119, 120, 239, 240, Infinity].map((m) => waitBucket(min(m)))).toEqual(["lt30m", "lt30m", "30m-1h", "30m-1h", "1h-2h", "1h-2h", "2h-4h", "2h-4h", "gt4h", "gt4h"]);
  });
});
