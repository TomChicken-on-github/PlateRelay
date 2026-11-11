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
 *     bring every order to rest and every printer back to available, and a
 *     queued order can still get printed.
 *
 * The last group switches off one safeguard at a time and checks that the
 * problem it prevents shows up, so the checker can't quietly stop seeing it.
 */
import { describe, expect, it } from "vitest";
import { explore, randomWalks } from "./explore.js";
import { type Budget, CURRENT_RULES, NO_FAULTS, type Options } from "./model.js";

type Faults = Partial<Budget>;

const SCENARIOS: Record<string, Faults> = {
  "no faults": {},
  "no faults, the order can be dispatched twice": { dispatches: 2 },
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
  "a person judges a job without waiting for the printer to come back": { linkDrops: 1, releases: 1 },
  "printer reboots while unreachable": { lanDrops: 1, reboots: 1 },
  "revision, archive, account deactivation, file expiry around a failure": { revisions: 1, archives: 1, deactivations: 1, fileExpiries: 1, deviceFailures: 1 },
  "panel link drops while someone starts an external job": { linkDrops: 1, externalStarts: 1 },
  "printer drops off the LAN while someone starts an external job": { lanDrops: 1, externalStarts: 1 },
  "printer fails while off the LAN": { lanDrops: 1, deviceFailures: 1 },
  "print stopped on the printer while off the LAN": { lanDrops: 1, screenStops: 1 },
  "printer fails while the panel link is down": { linkDrops: 1, deviceFailures: 1 },
  "print stopped on the printer while the panel link is down": { linkDrops: 1, screenStops: 1 },
  "external job after a start that never arrived": { externalStarts: 1, lostStarts: 1 },
  "panel link and LAN both drop": { linkDrops: 1, lanDrops: 1 },
  "daemon loses its state and an external job overwrites the last evidence": { daemonWipes: 1, externalStarts: 1 },
  "printer reboots unseen and the panel misses the start": { linkDrops: 1, lanDrops: 1, reboots: 1, dispatches: 1 },
  "a job pauses while its printer is in maintenance after a wrong judgement": { linkDrops: 1, daemonWipes: 1, pauses: 1, dispatches: 1 },
};

// One dispatch unless the scenario asks for more, which keeps every scenario small enough to explore completely.
const run = (faults: Faults, opts: Options = CURRENT_RULES) => explore({ printers: 1, orders: 1, budget: { ...NO_FAULTS, dispatches: 1, ...faults }, opts }, 1_500_000);

const summary = (problems: { kind: string; detail: string; trace: string[] }[]) =>
  problems.map((p) => `${p.kind}: ${p.detail}\n    ${p.trace.join(" → ")}`).join("\n");

describe("nothing gets stuck or misjudged", () => {
  for (const [name, faults] of Object.entries(SCENARIOS)) {
    it(name, { timeout: 120_000 }, () => {
      const r = run(faults);
      expect(r.complete).toBe(true);
      expect(summary(r.problems)).toBe("");
    });
  }

  it("the job runs unseen while both links are down, then an external job starts (first 300,000 states)", { timeout: 120_000 }, () => {
    // Too many states to explore completely in a test run, so this one only checks what the search reaches.
    const r = explore({ printers: 1, orders: 1, budget: { ...NO_FAULTS, dispatches: 1, linkDrops: 1, lanDrops: 1, externalStarts: 1 }, opts: CURRENT_RULES }, 300_000);
    expect(summary(r.problems)).toBe("");
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
      releases: 1,
    };
    const problems = randomWalks({ printers: 2, orders: 2, budget, opts: CURRENT_RULES }, 1500, 150, 20261109);
    expect(summary(problems)).toBe("");
  });
});

describe("what each safeguard is for", () => {
  const kinds = (faults: Faults, off: keyof Options) => new Set(run(faults, { ...CURRENT_RULES, [off]: false }).problems.map((p) => p.kind));

  it("without the daemon's check that the printer ran nothing since the dispatch, an external job during the transfer leaves a print on an uncleared plate", { timeout: 120_000 }, () => {
    expect(kinds({ externalStarts: 1 }, "daemonChecksPrinterUnused")).toContain("systemPrintOnUnclearedPlate");
  });

  it("the daemon's check alone is enough: the rules still hold when the panel doesn't tell the daemon about ended jobs", { timeout: 120_000 }, () => {
    for (const faults of [{ linkDrops: 1, releases: 1 }, { lostStarts: 1 }, { linkDrops: 1, externalStarts: 1 }]) {
      expect(summary(run(faults, { ...CURRENT_RULES, panelTellsDaemonWhenJobEnds: false }).problems)).toBe("");
    }
  });
});
