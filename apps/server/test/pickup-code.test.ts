import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCode, normalizeCode, PICKUP_ALPHABET } from "../src/orders/pickup.service.js";

describe("pickup codes", () => {
  it("use 31 characters without 0, O, 1, I or L", () => {
    assert.equal(PICKUP_ALPHABET.length, 31);
    assert.equal(new Set(PICKUP_ALPHABET).size, 31);
    for (const c of "0O1IL") assert.ok(!PICKUP_ALPHABET.includes(c));
  });

  it("normalize case, separators and the PR1 prefix only", () => {
    assert.equal(normalizeCode("pr1-7k3q-92ab"), "7K3Q92AB");
    assert.equal(normalizeCode("7K3Q 92AB"), "7K3Q92AB");
    assert.equal(formatCode("7K3Q92AB"), "PR1-7K3Q-92AB");
    assert.equal(normalizeCode("PR1-7K3Q-92A"), null);
  });

  it("reject look-alikes instead of mapping them", () => {
    for (const bad of ["7K3Q-92A0", "7K3Q-92AO", "7K3Q-92A1", "7K3Q-92AI", "7K3Q-92AL"]) assert.equal(normalizeCode(bad), null, bad);
  });
});
