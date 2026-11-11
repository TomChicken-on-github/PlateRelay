/*
 * Stress tests for the order / print job / printer state machines.
 *
 * Each scenario explores every reachable state of the model with a given set
 * of faults allowed, and checks that
 *   - no state change falls outside the transition tables,
 *   - the structural invariants hold everywhere,
 *   - the panel never concludes something the printer contradicts,
 *   - no system print starts on a plate nobody cleared,
 *   - once everything is delivered the panel agrees with the printer,
 *   - nothing is ever stuck: people plus a well-behaved world can always
 *     bring every order to rest and every printer back to idle, and a queued
 *     order can still get printed.
 *
 * The first group runs the current rules. The second switches off the rules
 * that were added after this exploration first found gaps (see `RuleFixes` in
 * model.ts) and checks that each gap is still caught, so the checker itself
 * can't quietly stop seeing them.
 */
import { describe, expect, it } from "vitest";
import { explore, randomWalks } from "./explore.js";
import { CURRENT_RULES, BEFORE_FIXES, type Budget, NO_FAULTS } from "./model.js";

type Faults = Partial<Budget>;

const SCENARIOS: Record<string, Faults> = {
  "no faults": {},
  "a start that never reaches the printer": { lostStarts: 1 },
  "a start the printer acts on late": { slowCommands: 1 },
  "panel link drops": { linkDrops: 1 },
  "printer drops off the LAN": { lanDrops: 1 },
  "someone starts an external job": { externalStarts: 1 },
  "someone stops the print on the printer": { screenStops: 1 },
  "printer pauses and is resumed on its screen": { pauses: 1, screenResumes: 1 },
  "printer fails": { deviceFailures: 1 },
  "a command expires before delivery": { expiries: 1 },
  "file transfer fails": { transferFailures: 1 },
  "daemon restarts and loses its local state": { daemonWipes: 1 },
  "printer reboots while unreachable": { lanDrops: 1, reboots: 1, dispatches: 1 },
  "revision, archive, account deactivation, file expiry around a failure": { revisions: 1, archives: 1, deactivations: 1, fileExpiries: 1, deviceFailures: 1 },
  "panel link drops while someone starts an external job": { linkDrops: 1, externalStarts: 1, dispatches: 1 },
  "printer drops off the LAN while someone starts an external job": { lanDrops: 1, externalStarts: 1, dispatches: 1 },
  "printer fails while off the LAN": { lanDrops: 1, deviceFailures: 1, dispatches: 1 },
  "print stopped on the printer while off the LAN": { lanDrops: 1, screenStops: 1, dispatches: 1 },
  "printer fails while the panel link is down": { linkDrops: 1, deviceFailures: 1, dispatches: 1 },
  "print stopped on the printer while the panel link is down": { linkDrops: 1, screenStops: 1, dispatches: 1 },
  "external job after a start that never arrived": { externalStarts: 1, lostStarts: 1, dispatches: 1 },
  "panel link and LAN both drop": { linkDrops: 1, lanDrops: 1, dispatches: 1 },
  "daemon loses its state and an external job overwrites the last evidence": { daemonWipes: 1, externalStarts: 1, dispatches: 1 },
  "printer reboots unseen and the panel misses the start": { linkDrops: 1, lanDrops: 1, reboots: 1, dispatches: 1 },
  "a misjudged job pauses while the printer is in maintenance": { linkDrops: 1, daemonWipes: 1, pauses: 1, dispatches: 1 },
  "an administrator reclaims a printer while a link is down": { linkDrops: 1, reclaims: 1, dispatches: 1 },
  "an administrator reclaims a printer that is off the LAN": { lanDrops: 1, reclaims: 1, dispatches: 1 },
};

const run = (faults: Faults, current: boolean) =>
  explore({ printers: 1, orders: 1, budget: { ...NO_FAULTS, ...faults }, fixes: current ? CURRENT_RULES : BEFORE_FIXES });

const summary = (problems: { kind: string; detail: string; trace: string[] }[]) =>
  problems.map((p) => `${p.kind}: ${p.detail}\n    ${p.trace.join(" → ")}`).join("\n");

describe("under the current rules nothing gets stuck or misjudged", () => {
  for (const [name, faults] of Object.entries(SCENARIOS)) {
    it(name, { timeout: 120_000 }, () => {
      const r = run(faults, true);
      expect(r.complete).toBe(true);
      expect(summary(r.problems)).toBe("");
    });
  }

  // Too many states to finish; the first 300 000 (breadth-first, so every short path) must be clean.
  it("the job runs unseen while both links are down, then an external job starts", { timeout: 300_000 }, () => {
    const budget = { ...NO_FAULTS, linkDrops: 1, lanDrops: 1, externalStarts: 1, dispatches: 1 };
    expect(summary(explore({ printers: 1, orders: 1, budget, fixes: CURRENT_RULES }, 300_000).problems)).toBe("");
  });

  it("two printers, two orders, every kind of fault at once (random walks)", { timeout: 300_000 }, () => {
    const budget: Budget = {
      ...NO_FAULTS,
      linkDrops: 2,
      lanDrops: 2,
      reboots: 1,
      daemonWipes: 1,
      externalStarts: 2,
      screenStops: 2,
      screenResumes: 1,
      pauses: 2,
      deviceFailures: 2,
      lostStarts: 1,
      slowCommands: 1,
      expiries: 1,
      transferFailures: 1,
      fileExpiries: 1,
      dispatches: 5,
      revisions: 1,
      archives: 1,
      deactivations: 1,
      reclaims: 1,
    };
    const problems = randomWalks({ printers: 2, orders: 2, budget, fixes: CURRENT_RULES }, 1500, 150, 20261109);
    expect(summary(problems)).toBe("");
  });
});

describe("without the later fixes", () => {
  const kinds = (faults: Faults) => new Set(run(faults, false).problems.map((p) => p.kind));

  it("the rules still hold when nothing goes wrong", () => {
    const r = run({}, false);
    expect(r.complete).toBe(true);
    expect(summary(r.problems)).toBe("");
  });

  for (const name of [
    "someone stops the print on the printer",
    "printer pauses and is resumed on its screen",
    "printer fails",
    "a command expires before delivery",
    "file transfer fails",
    "revision, archive, account deactivation, file expiry around a failure",
  ]) {
    it(`the rules still hold when ${name}`, { timeout: 120_000 }, () => {
      expect(summary(run(SCENARIOS[name]!, false).problems)).toBe("");
    });
  }

  // The gaps the fixes closed. Each must still show up with the fixes off.
  it("gap: stopping a start that never arrived leaves staff with no correct judgement", () => {
    expect(kinds({ lostStarts: 1 })).toContain("staffJudgementHasNoCorrectOption");
  });

  it("gap: a reconcile mismatch outlives its job and blocks the printer for good", { timeout: 120_000 }, () => {
    expect(kinds({ linkDrops: 1 })).toContain("stuck");
  });

  it("gap: a reconnect snapshot taken before the start command arrived sends the order back while it still prints", { timeout: 120_000 }, () => {
    expect(kinds({ linkDrops: 1 })).toContain("outcomeContradictsPrinter");
  });

  it("gap: an external job that ran during the transfer does not stop the start", { timeout: 120_000 }, () => {
    expect(kinds({ externalStarts: 1 })).toContain("systemPrintOnUnclearedPlate");
  });

  it("gap: a printer freed while unreachable is idle and lost at once", { timeout: 120_000 }, () => {
    expect(kinds({ lanDrops: 1 })).toContain("invariant");
  });

  it("gap: an external job that ended while the printer was unreachable is never noticed", { timeout: 120_000 }, () => {
    const k = kinds({ lanDrops: 1, externalStarts: 1, dispatches: 1 });
    expect(k).toContain("reconcileNoRowMatched");
    expect(k).toContain("stuck");
  });

  // Later fixes, switched off one at a time.
  const without = (fix: keyof typeof CURRENT_RULES, faults: Faults, maxStates?: number) =>
    new Set(explore({ printers: 1, orders: 1, budget: { ...NO_FAULTS, ...faults }, fixes: { ...CURRENT_RULES, [fix]: false } }, maxStates).problems.map((p) => p.kind));

  it("gap: a job that ran unseen is taken for one that never started once another job hides it", { timeout: 300_000 }, () => {
    expect(without("notStartedNeedsUnchangedRunCount", { daemonWipes: 1, externalStarts: 1, dispatches: 1 })).toContain("outcomeContradictsPrinter");
  });

  it("gap: the printer reports the end of a job the panel never saw start", { timeout: 300_000 }, () => {
    expect(without("printerEndAppliesFromAnyPhase", { linkDrops: 1, lanDrops: 1, reboots: 1, dispatches: 1 })).toContain("eventNotCoveredByRules");
  });

  it("gap: a print paused on a printer in maintenance can't be stopped from the panel", { timeout: 300_000 }, () => {
    expect(without("maintenanceAllowsStop", { linkDrops: 1, daemonWipes: 1, pauses: 1, dispatches: 1 })).toContain("stuck");
  });
});
