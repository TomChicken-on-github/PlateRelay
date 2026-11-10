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
 * "As written" pins the gaps found in the current rules, so that they stay
 * visible until the rules change. "Amended" shows the same scenarios pass
 * once the proposed changes (see `Amendments` in model.ts) are applied.
 */
import { describe, expect, it } from "vitest";
import { explore, randomWalks } from "./explore.js";
import { ALL_AMENDMENTS, AS_WRITTEN, type Budget, NO_FAULTS } from "./model.js";

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
};

const run = (faults: Faults, amended: boolean) =>
  explore({ printers: 1, orders: 1, budget: { ...NO_FAULTS, ...faults }, amend: amended ? ALL_AMENDMENTS : AS_WRITTEN });

const summary = (problems: { kind: string; detail: string; trace: string[] }[]) =>
  problems.map((p) => `${p.kind}: ${p.detail}\n    ${p.trace.join(" → ")}`).join("\n");

describe("with the proposed amendments nothing gets stuck or misjudged", () => {
  for (const [name, faults] of Object.entries(SCENARIOS)) {
    it(name, { timeout: 120_000 }, () => {
      const r = run(faults, true);
      expect(r.complete).toBe(true);
      expect(summary(r.problems)).toBe("");
    });
  }

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
    };
    const problems = randomWalks({ printers: 2, orders: 2, budget, amend: ALL_AMENDMENTS }, 1500, 150, 20261109);
    expect(summary(problems)).toBe("");
  });
});

describe("the rules as written", () => {
  const kinds = (faults: Faults) => new Set(run(faults, false).problems.map((p) => p.kind));

  it("hold when nothing goes wrong", () => {
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
    it(`hold when ${name}`, { timeout: 120_000 }, () => {
      expect(summary(run(SCENARIOS[name]!, false).problems)).toBe("");
    });
  }

  // Known gaps. Each of these should start failing once the rules are fixed.
  it("known gap: stopping a start that never arrived leaves staff with no correct judgement", () => {
    expect(kinds({ lostStarts: 1 })).toContain("staffJudgementHasNoCorrectOption");
  });

  it("known gap: a reconcile mismatch outlives its job and blocks the printer for good", { timeout: 120_000 }, () => {
    expect(kinds({ linkDrops: 1 })).toContain("stuck");
  });

  it("known gap: a reconnect snapshot taken before the start command arrived sends the order back while it still prints", { timeout: 120_000 }, () => {
    expect(kinds({ linkDrops: 1 })).toContain("outcomeContradictsPrinter");
  });

  it("known gap: an external job that ran during the transfer does not stop the start", { timeout: 120_000 }, () => {
    expect(kinds({ externalStarts: 1 })).toContain("systemPrintOnUnclearedPlate");
  });

  it("known gap: a printer freed while unreachable is idle and lost at once", { timeout: 120_000 }, () => {
    expect(kinds({ lanDrops: 1 })).toContain("invariant");
  });

  it("known gap: an external job that ended while the printer was unreachable is never noticed", { timeout: 120_000 }, () => {
    const k = kinds({ lanDrops: 1, externalStarts: 1, dispatches: 1 });
    expect(k).toContain("reconcileNoRowMatched");
    expect(k).toContain("stuck");
  });
});
