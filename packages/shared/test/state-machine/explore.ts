/*
 * Exhaustive and random exploration of the model.
 *
 * `explore` walks every reachable state breadth-first, so the trace it keeps
 * for each finding is a shortest one. Afterwards it checks that no state is a
 * trap: from every reachable state, people and a well-behaved world (no
 * further faults) must still be able to bring everything to rest.
 */
import {
  type Config,
  type Finding,
  type State,
  describe,
  initialState,
  invariantViolations,
  printedOrBeyond,
  quiescentMismatch,
  settled,
  successors,
} from "./model.js";

export interface Problem {
  kind: string;
  detail: string;
  /** Shortest sequence of actions from the start that shows it. */
  trace: string[];
  state: string;
  count: number;
}

export interface Report {
  states: number;
  edges: number;
  complete: boolean;
  problems: Problem[];
}

const key = (s: State) => JSON.stringify(s);

export function explore(cfg: Config, maxStates = 3_000_000): Report {
  const init = initialState(cfg);
  const index = new Map<string, number>([[key(init), 0]]);
  const parent: number[] = [-1];
  const via: string[] = [""];
  const brief: string[] = [describe(init)];
  // Edges a cooperative world can take: human and benign actions only.
  const coop: number[][] = [[]];
  const isSettled: boolean[] = [settled(init)];
  const orderDone: number[] = [0];
  const orderWaiting: number[] = [0];
  const problems = new Map<string, Problem>();
  let frontier: State[] = [init];
  let frontierIds = [0];
  let edges = 0;
  let complete = true;

  const traceTo = (id: number) => {
    const t: string[] = [];
    for (let i = id; parent[i]! >= 0; i = parent[i]!) t.push(via[i]!);
    return t.reverse();
  };
  const report = (kind: string, detail: string, id: number, extra?: string) => {
    const k = `${kind}: ${detail}`;
    const p = problems.get(k);
    if (p) p.count++;
    else problems.set(k, { kind, detail, trace: [...traceTo(id), ...(extra ? [extra] : [])], state: brief[id]!, count: 1 });
  };
  const bits = (s: State, f: (i: number) => boolean) => s.orders.reduce((m, _, i) => (f(i) ? m | (1 << i) : m), 0);

  while (frontier.length > 0) {
    const next: State[] = [];
    const nextIds: number[] = [];
    for (let f = 0; f < frontier.length; f++) {
      const st = frontier[f]!;
      const id = frontierIds[f]!;
      for (const v of invariantViolations(st)) report("invariant", v.replace(/\d+/g, "N"), id);
      for (const v of quiescentMismatch(st)) report("panelDisagreesWithPrinterAtRest", v.replace(/\d+/g, "N"), id);
      for (const step of successors(st)) {
        edges++;
        for (const fd of step.findings as Finding[]) report(fd.kind, fd.detail.replace(/\d+/g, "N"), id, step.label);
        const k = key(step.next);
        let to = index.get(k);
        if (to === undefined) {
          if (index.size >= maxStates) {
            complete = false;
            continue;
          }
          to = index.size;
          index.set(k, to);
          parent.push(id);
          via.push(step.label);
          brief.push(describe(step.next));
          coop.push([]);
          isSettled.push(settled(step.next));
          orderDone.push(bits(step.next, (i) => printedOrBeyond(step.next.orders[i]!)));
          orderWaiting.push(bits(step.next, (i) => step.next.orders[i]!.s === "QUEUED" && step.next.budget.dispatches > 0));
          next.push(step.next);
          nextIds.push(to);
        }
        if (step.cls !== "adverse") coop[id]!.push(to);
      }
    }
    frontier = next;
    frontierIds = nextIds;
  }

  if (complete) {
    const n = index.size;
    // Reverse graph of cooperative edges.
    const rev: number[][] = Array.from({ length: n }, () => []);
    for (let a = 0; a < n; a++) for (const b of coop[a]!) rev[b]!.push(a);
    const canReach = (goal: (i: number) => boolean) => {
      const ok = new Uint8Array(n);
      const stack: number[] = [];
      for (let i = 0; i < n; i++) if (goal(i)) (ok[i] = 1), stack.push(i);
      while (stack.length) for (const a of rev[stack.pop()!]!) if (!ok[a]) (ok[a] = 1), stack.push(a);
      return ok;
    };
    // 1. No trap: everything can still come to rest.
    const rest = canReach((i) => isSettled[i]!);
    for (let i = 0; i < n; i++) {
      if (!rest[i]) {
        // Report only the entry points: stuck states whose parent was not stuck.
        if (parent[i]! < 0 || rest[parent[i]!]) report("stuck", stuckShape(brief[i]!), i);
      }
    }
    // 2. A queued order can still get printed (cancelling is not the only way out).
    for (let o = 0; o < cfg.orders; o++) {
      const printable = canReach((i) => (orderDone[i]! & (1 << o)) !== 0);
      for (let i = 0; i < n; i++) {
        if (orderWaiting[i]! & (1 << o) && !printable[i] && rest[i]) {
          if (parent[i]! < 0 || printable[parent[i]!] || !(orderWaiting[parent[i]!]! & (1 << o))) report("queuedOrderCanNeverPrint", stuckShape(brief[i]!), i);
        }
      }
    }
  }
  return { states: index.size, edges, complete, problems: [...problems.values()] };
}

/** Groups stuck states by what the panel shows, ignoring ids and queue lengths. */
function stuckShape(s: string): string {
  return s.split(" | ").slice(0, 2).join(" | ").replace(/\(job\d+\)/g, "(job)");
}

// ---------------------------------------------------------------- random walks

/** Small deterministic generator so failures can be replayed from the seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** From `st`, can a cooperative world still bring everything to rest? Bounded search. */
export function canComeToRest(st: State, limit = 20_000): boolean | "unknown" {
  const seen = new Set<string>([key(st)]);
  let frontier = [st];
  while (frontier.length) {
    const next: State[] = [];
    for (const s of frontier) {
      if (settled(s)) return true;
      for (const step of successors(s)) {
        if (step.cls === "adverse") continue;
        const k = key(step.next);
        if (seen.has(k)) continue;
        if (seen.size >= limit) return "unknown";
        seen.add(k);
        next.push(step.next);
      }
    }
    frontier = next;
  }
  return false;
}

export function randomWalks(cfg: Config, walks: number, length: number, seed: number): Problem[] {
  const problems = new Map<string, Problem>();
  const report = (kind: string, detail: string, trace: string[], st: State) => {
    const k = `${kind}: ${detail}`;
    const p = problems.get(k);
    if (p) {
      p.count++;
      if (trace.length < p.trace.length) (p.trace = [...trace]), (p.state = describe(st));
    } else problems.set(k, { kind, detail, trace: [...trace], state: describe(st), count: 1 });
  };
  for (let w = 0; w < walks; w++) {
    const rand = rng(seed + w);
    let st = initialState(cfg);
    const trace: string[] = [];
    for (let i = 0; i < length; i++) {
      const steps = successors(st);
      if (steps.length === 0) break;
      const step = steps[Math.floor(rand() * steps.length)]!;
      trace.push(step.label);
      for (const fd of step.findings) report(fd.kind, fd.detail.replace(/\d+/g, "N"), trace, st);
      st = step.next;
      for (const v of invariantViolations(st)) report("invariant", v.replace(/\d+/g, "N"), trace, st);
      for (const v of quiescentMismatch(st)) report("panelDisagreesWithPrinterAtRest", v.replace(/\d+/g, "N"), trace, st);
    }
    if (canComeToRest(st) === false) report("stuck", stuckShape(describe(st)), trace, st);
  }
  return [...problems.values()];
}
