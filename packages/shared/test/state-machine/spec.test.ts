import { describe, expect, it } from "vitest";
import {
  JOB_OUTCOMES,
  JUDGEMENTS,
  ORDER_STATES,
  ORDER_TRANSITIONS,
  PRINTER_STATES,
  PRINTER_TRANSITIONS,
  TERMINAL_ORDER_STATES,
  jobEndEffect,
} from "../../src/state-machine/spec.js";

describe("transition tables", () => {
  it("never leave a terminal order state", () => {
    for (const row of Object.values(ORDER_TRANSITIONS)) {
      for (const from of row.from) expect(TERMINAL_ORDER_STATES).not.toContain(from);
    }
  });

  it("give every non-terminal order state a way out", () => {
    for (const s of ORDER_STATES) {
      if (TERMINAL_ORDER_STATES.includes(s)) continue;
      expect(Object.values(ORDER_TRANSITIONS).some((row) => (row.from as readonly string[]).includes(s))).toBe(true);
    }
  });

  it("give every printer state a way in and a way out", () => {
    for (const s of PRINTER_STATES) {
      const rows = Object.values(PRINTER_TRANSITIONS);
      expect(rows.some((row) => (row.from as readonly string[]).includes(s))).toBe(true);
      expect(rows.some((row) => row.to === s)).toBe(true);
    }
  });

  it("only cancel orders that have not been dispatched", () => {
    expect(ORDER_TRANSITIONS.cancel.from).toEqual(["PENDING_REVIEW", "QUEUED"]);
  });

  it("never take a printer from an external job straight back to idle", () => {
    for (const row of Object.values(PRINTER_TRANSITIONS)) {
      if ((row.from as readonly string[]).includes("EXTERNAL_JOB")) expect(row.to).toBe("CLEARING_REQUIRED");
    }
  });
});

describe("what a job's end does to its order and printer", () => {
  it("is defined for every outcome", () => {
    for (const outcome of JOB_OUTCOMES) {
      for (const printerLatest of ["IDLE", "RUNNING_OTHER_JOB"] as const) {
        const e = jobEndEffect({ outcome, printerLatest });
        expect(ORDER_TRANSITIONS[e.order]).toBeDefined();
        expect(PRINTER_TRANSITIONS[e.printer]).toBeDefined();
      }
    }
  });

  it("never hands the printer straight back to idle, however the job ends", () => {
    for (const outcome of JOB_OUTCOMES) {
      expect(PRINTER_TRANSITIONS[jobEndEffect({ outcome, printerLatest: "IDLE" }).printer].to).toBe("CLEARING_REQUIRED");
      expect(PRINTER_TRANSITIONS[jobEndEffect({ outcome, printerLatest: "RUNNING_OTHER_JOB" }).printer].to).not.toBe("IDLE");
    }
  });

  it("only reaches idle from a state a person confirmed or a clean connect", () => {
    const toIdle = Object.entries(PRINTER_TRANSITIONS).filter(([, row]) => row.to === "IDLE").map(([name]) => name);
    expect(toIdle.sort()).toEqual(["connectedIdle", "endMaintenance", "plateCleared"]);
  });

  it("lets a forced reclaim take back every occupied state and nothing else", () => {
    expect([...PRINTER_TRANSITIONS.forceReclaimed.from].sort()).toEqual(["EXTERNAL_JOB", "PAUSED", "PREPARING", "PRINTING"]);
    expect(PRINTER_TRANSITIONS.forceReclaimed.to).toBe("CLEARING_REQUIRED");
  });

  it("maps every judgement a person can make to an order transition that exists", () => {
    for (const outcome of Object.values(JUDGEMENTS)) {
      const e = jobEndEffect({ outcome, printerLatest: "IDLE" });
      expect(ORDER_TRANSITIONS[e.order]).toBeDefined();
    }
    expect(jobEndEffect({ outcome: JUDGEMENTS.notStarted, printerLatest: "IDLE" }).order).toBe("jobReturnedToQueue");
  });

  it("returns the order to the queue whenever printing never started", () => {
    for (const outcome of ["STOPPED_BEFORE_START", "SEND_FAILED", "START_FAILED"] as const) {
      expect(jobEndEffect({ outcome, printerLatest: "IDLE" }).order).toBe("jobReturnedToQueue");
    }
  });

  it("flags a start failure for staff", () => {
    expect(jobEndEffect({ outcome: "START_FAILED", printerLatest: "IDLE" }).raiseStartFailed).toBe(true);
    expect(jobEndEffect({ outcome: "SEND_FAILED", printerLatest: "IDLE" }).raiseStartFailed).toBe(false);
  });
});
