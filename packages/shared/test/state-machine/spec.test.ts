import { describe, expect, it } from "vitest";
import {
  JOB_OUTCOMES,
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
      for (const printerReportedPreparing of [true, false]) {
        for (const printerLatest of ["IDLE", "RUNNING_OTHER_JOB"] as const) {
          const e = jobEndEffect({ outcome, printerReportedPreparing, printerLatest });
          expect(ORDER_TRANSITIONS[e.order]).toBeDefined();
          expect(PRINTER_TRANSITIONS[e.printer]).toBeDefined();
        }
      }
    }
  });

  it("requires clearing after anything that may have put material on the plate", () => {
    const at = (outcome: (typeof JOB_OUTCOMES)[number], prepared: boolean) =>
      PRINTER_TRANSITIONS[jobEndEffect({ outcome, printerReportedPreparing: prepared, printerLatest: "IDLE" }).printer].to;
    expect(at("FINISHED", true)).toBe("CLEARING_REQUIRED");
    expect(at("FAILED", true)).toBe("CLEARING_REQUIRED");
    expect(at("STOPPED_BEFORE_START", true)).toBe("CLEARING_REQUIRED");
    expect(at("START_FAILED", true)).toBe("CLEARING_REQUIRED");
    expect(at("STOPPED_BEFORE_START", false)).toBe("IDLE");
    expect(at("SEND_FAILED", false)).toBe("IDLE");
  });

  it("returns the order to the queue whenever printing never started", () => {
    for (const outcome of ["STOPPED_BEFORE_START", "SEND_FAILED", "START_FAILED"] as const) {
      expect(jobEndEffect({ outcome, printerReportedPreparing: true, printerLatest: "IDLE" }).order).toBe("jobReturnedToQueue");
    }
  });

  it("flags a start failure for staff", () => {
    expect(jobEndEffect({ outcome: "START_FAILED", printerReportedPreparing: true, printerLatest: "IDLE" }).raiseStartFailed).toBe(true);
    expect(jobEndEffect({ outcome: "SEND_FAILED", printerReportedPreparing: false, printerLatest: "IDLE" }).raiseStartFailed).toBe(false);
  });
});
