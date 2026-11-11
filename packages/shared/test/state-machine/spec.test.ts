import { describe, expect, it } from "vitest";
import {
  FAULTS_REMOVED_BY_PEOPLE,
  FAULT_REASONS,
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

  it("make a printer available only when a person confirms a cleared plate", () => {
    const toAvailable = Object.entries(PRINTER_TRANSITIONS).filter(([, row]) => row.to === "AVAILABLE");
    expect(toAvailable.map(([name]) => name)).toEqual(["plateCleared"]);
    expect(PRINTER_TRANSITIONS.plateCleared.from).toEqual(["CLEARING_REQUIRED"]);
  });

  it("lead every way out of work or fault to clearing, except the printer reporting it runs again", () => {
    for (const [name, row] of Object.entries(PRINTER_TRANSITIONS)) {
      const from = row.from as readonly string[];
      if (from.includes("WORKING") && row.to !== "FAULT") expect(row.to).toBe("CLEARING_REQUIRED");
      if (from.includes("FAULT") && name !== "printerResumed") expect(row.to).toBe("CLEARING_REQUIRED");
    }
  });

  it("let a person remove only the fault reasons that are theirs to remove", () => {
    for (const reason of FAULTS_REMOVED_BY_PEOPLE) expect(FAULT_REASONS).toContain(reason);
    expect(FAULTS_REMOVED_BY_PEOPLE).not.toContain("UNREACHABLE");
    expect(FAULTS_REMOVED_BY_PEOPLE).not.toContain("PRINTER_ERROR");
  });
});

describe("what a job's end does to its order", () => {
  it("is defined for every outcome", () => {
    for (const outcome of JOB_OUTCOMES) expect(ORDER_TRANSITIONS[jobEndEffect(outcome).order]).toBeDefined();
  });

  it("returns the order to the queue whenever printing never started", () => {
    for (const outcome of ["STOPPED_BEFORE_START", "SEND_FAILED", "START_FAILED"] as const) {
      expect(jobEndEffect(outcome).order).toBe("jobReturnedToQueue");
    }
  });

  it("flags a failed send for staff and nothing else", () => {
    for (const outcome of JOB_OUTCOMES) expect(jobEndEffect(outcome).raiseSendFailed).toBe(outcome === "SEND_FAILED");
  });

  it("maps every judgement a person can make to an outcome", () => {
    expect(Object.values(JUDGEMENTS).sort()).toEqual(["FAILED", "FINISHED", "STOPPED_BEFORE_START"]);
  });
});
