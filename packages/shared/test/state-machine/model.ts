/*
 * Executable model of the panel, one daemon and its printers, written from the
 * design rules for orders, print jobs, printers, the daemon protocol and the
 * reconnect reconciliation table.
 *
 * Three layers are modelled separately, because most of the hard cases come
 * from them disagreeing:
 *   - the device: what the printer is physically doing (plus "truth" facts the
 *     panel can't see, used only to judge the panel's conclusions);
 *   - the daemon: transfers, the persisted outbox, the "never start" markers;
 *   - the panel: orders, jobs, printers, flags, the panel→daemon command queue.
 *
 * Every step is one action, labelled
 *   human   – something a person does in the panel,
 *   benign  – the world behaving: messages delivered, links restored, the
 *             printer carrying out a command or finishing its print,
 *   adverse – something going wrong: links dropping, the printer failing,
 *             someone pressing buttons on the printer's screen, the daemon
 *             losing its local state, a command expiring.
 * Adverse actions are limited by a budget so the state space stays finite.
 *
 * The model never writes an order or printer state directly: it goes through
 * the transition tables in src/state-machine/spec.ts and records a finding
 * whenever a rule would need a transition the table doesn't list.
 */
import {
  type FaultReason,
  type JobOutcome,
  type JobPhase,
  type OrderState,
  type OrderTrigger,
  type PrinterState,
  type PrinterTrigger,
  JUDGEMENTS,
  JOB_TRANSITIONS,
  type JobTrigger,
  ORDER_TRANSITIONS,
  PRINTER_TRANSITIONS,
  TERMINAL_ORDER_STATES,
  jobEndEffect,
} from "../../src/state-machine/spec.js";

// ---------------------------------------------------------------- device

export type DeviceState = "IDLE" | "PREPARING" | "PRINTING" | "PAUSED" | "FINISHED" | "FAILED" | "CANCELLED";
/** A system job id, an external job, or nothing. */
export type DeviceJob = number | "EXT" | null;

export interface Device {
  s: DeviceState;
  job: DeviceJob;
  /** This run reached printing (so an end now is "after start"). */
  printed: boolean;
  pausedFromPrep: boolean;
  pauseReason: "USER" | "ERROR" | null;
  boot: number;
  /** How many print runs (system or external) this printer has begun. */
  runs: number;
  reachable: boolean;
  /** Something is (or may be) on the plate. Cleared only by a person clearing it. */
  plateDirty: boolean;
  /** Commands sent over the LAN that the printer hasn't acted on yet. */
  lanStart: number | null;
  lanStop: boolean;
  lanResume: boolean;
  /** System files on the printer's storage. */
  files: number[];
}

export const running = (s: DeviceState) => s === "PREPARING" || s === "PRINTING" || s === "PAUSED";

// ---------------------------------------------------------------- messages

export interface View {
  s: DeviceState;
  job: DeviceJob;
  boot: number;
  runs: number;
  pauseReason: "USER" | "ERROR" | null;
  pausedFromPrep: boolean;
  files: number[];
  /** Jobs the daemon still holds before sending the start (queued, downloading, uploading). */
  pendingStarts: number[];
  /** End events the daemon has recorded and not yet had acknowledged. */
  endRecords: { job: number; kind: "finished" | "failed" | "cancelled"; beforeStart: boolean; fromPrinter: boolean }[];
}

export type MsgKind =
  | "startAccepted"
  | "staged"
  | "snapshot"
  | "started"
  | "paused"
  | "resumed"
  | "finished"
  | "failed"
  | "cancelled"
  | "startRejectedBusy"
  | "startFailed"
  | "startExpired"
  | "externalStarted"
  | "externalEnded"
  | "connectionDown"
  | "connectionUp";

export interface Msg {
  p: number;
  kind: MsgKind;
  job?: number;
  beforeStart?: boolean;
  /** The end was reported by the printer itself (not by the daemon aborting a transfer). */
  fromPrinter?: boolean;
  /** Was already in the outbox when the daemon sent its reconnect snapshot. */
  olderThanSnapshot?: boolean;
  view: View;
}

export type CmdKind = "start" | "stop" | "stopExternal" | "resume";
export interface Cmd {
  p: number;
  kind: CmdKind;
  job?: number;
  /** For a start: how many runs the panel knew of when it dispatched. */
  seenRuns?: number;
  /** Expired before it reached the daemon; the daemon answers "expired" and never runs it. */
  expired: boolean;
}

// ---------------------------------------------------------------- panel

export interface Order {
  s: OrderState;
  hasSortValue: boolean;
  revisions: number;
  noReprint: boolean;
  archived: boolean;
  fileExpired: boolean;
  userActive: boolean;
  job: number | null;
  /** Printer of the last job, for storing the finished part. */
  lastPrinter: number | null;
}

export interface Job {
  order: number;
  printer: number;
  phase: JobPhase;
  outcome: JobOutcome | null;
  pausedFrom: "PREPARING" | "PRINTING" | null;
  /** Print runs of the printer the panel knew of when it dispatched. */
  seenRuns: number;
  /** The daemon confirmed it took the start command. */
  startAccepted: boolean;
  /** Connection during which the start command reached the daemon (null = not yet). */
  startDeliveredIn: number | null;
  staged: boolean;
  /** The printer itself reported preparing for this job. */
  prepared: boolean;
  stopSent: boolean;
}

export interface Printer {
  s: PrinterState;
  /** The job of ours it holds, until that job has ended. */
  job: number | null;
  /** It reports something running that is not its current job (an external job, or a job that already ended). */
  busyWithOther: boolean;
  faults: FaultReason[];
  /** Whether the panel currently has a live path to this printer. */
  connected: boolean;
  last: View;
}

export interface Budget {
  linkDrops: number;
  lanDrops: number;
  reboots: number;
  daemonWipes: number;
  externalStarts: number;
  screenStops: number;
  screenResumes: number;
  pauses: number;
  deviceFailures: number;
  lostStarts: number;
  /** Commands the printer acts on only after people have already given up waiting. */
  slowCommands: number;
  expiries: number;
  transferFailures: number;
  fileExpiries: number;
  dispatches: number;
  revisions: number;
  archives: number;
  deactivations: number;
  /** Times a person judges a job on a faulted printer without waiting for it to come back (never needed for things to come to rest). */
  releases: number;
}

/** Variants of the rules, to compare designs. The defaults are the current rules. */
export interface Options {
  /**
   * Before sending a start the daemon checks that the printer has run nothing since the dispatch
   * (and that it could see the printer throughout the transfer); otherwise it refuses.
   */
  daemonChecksPrinterUnused: boolean;
  /**
   * A stop for a staged job the printer never took: if the daemon has watched the printer ever since
   * and it began nothing, the daemon deletes the file, promises never to start it and reports
   * "cancelled before start" itself.
   */
  daemonConfirmsStopOfUnstartedJob: boolean;
  /** Whenever the panel ends a job (a judgement, a failed send, a reconnect), it also tells the daemon to never start it. */
  panelTellsDaemonWhenJobEnds: boolean;
}
export const CURRENT_RULES: Options = { daemonChecksPrinterUnused: true, daemonConfirmsStopOfUnstartedJob: true, panelTellsDaemonWhenJobEnds: true };

export interface State {
  opts: Options;
  orders: Order[];
  jobs: Job[];
  printers: Printer[];
  devices: Device[];
  daemon: {
    link: boolean;
    /** Counts panel connections, to tell "answered in this connection" from "before it". */
    epoch: number;
    outbox: Msg[];
    inbox: Cmd[];
    transfers: { p: number; job: number; seenRuns: number; printerWasUsed: boolean }[];
    neverStart: number[];
    /** Jobs whose start was sent, with the run count then; `watched` stays true while the daemon never lost sight of the printer. */
    staged: { job: number; p: number; runs: number; watched: boolean }[];
    /** Orders whose file is in the daemon's local cache (a reprint needs no download). */
    cache: number[];
  };
  /** Facts about each job the panel can't see directly. */
  truth: { prepared: number[]; printed: number[]; finished: number[] };
  budget: Budget;
}

// ---------------------------------------------------------------- findings

export type FindingKind =
  | "orderTransitionNotInTable"
  | "printerTransitionNotInTable"
  | "jobTransitionNotInTable"
  | "eventNotCoveredByRules"
  | "reconcileNoRowMatched"
  | "outcomeContradictsPrinter"
  | "staffJudgementHasNoCorrectOption"
  | "systemPrintOnUnclearedPlate"
  | "staleEventTakenForLateStart";

export interface Finding {
  kind: FindingKind;
  detail: string;
}

/**
 * "backstop" is the administrator's forced reclaim: allowed, but the rules must never depend on it,
 * so the liveness checks don't count it as a way out.
 */
export type ActionClass = "human" | "benign" | "adverse" | "backstop";

export interface Step {
  label: string;
  cls: ActionClass;
  next: State;
  findings: Finding[];
}

export interface Config {
  printers: number;
  orders: number;
  budget: Budget;
  opts?: Options;
}

export const NO_FAULTS: Budget = {
  linkDrops: 0,
  lanDrops: 0,
  reboots: 0,
  daemonWipes: 0,
  externalStarts: 0,
  screenStops: 0,
  screenResumes: 0,
  pauses: 0,
  deviceFailures: 0,
  lostStarts: 0,
  slowCommands: 0,
  expiries: 0,
  transferFailures: 0,
  fileExpiries: 0,
  dispatches: 2,
  revisions: 0,
  archives: 0,
  deactivations: 0,
  releases: 0,
};

const MAX_REVISIONS = 1;

export function initialState(cfg: Config): State {
  const devices: Device[] = Array.from({ length: cfg.printers }, () => ({
    s: "IDLE",
    job: null,
    printed: false,
    pausedFromPrep: false,
    pauseReason: null,
    boot: 0,
    runs: 0,
    reachable: true,
    plateDirty: false,
    lanStart: null,
    lanStop: false,
    lanResume: false,
    files: [],
  }));
  const st: State = {
    opts: { ...(cfg.opts ?? CURRENT_RULES) },
    orders: Array.from({ length: cfg.orders }, () => ({
      s: "PENDING_REVIEW",
      hasSortValue: false,
      revisions: 0,
      noReprint: false,
      archived: false,
      fileExpired: false,
      userActive: true,
      job: null,
      lastPrinter: null,
    })),
    jobs: [],
    printers: [],
    devices,
    daemon: { link: true, epoch: 0, outbox: [], inbox: [], transfers: [], neverStart: [], staged: [], cache: [] },
    truth: { prepared: [], printed: [], finished: [] },
    budget: { ...cfg.budget },
  };
  st.printers = devices.map((_, p) => ({ s: "AVAILABLE", job: null, busyWithOther: false, faults: [], connected: true, last: view(st, p) }));
  return st;
}

// ---------------------------------------------------------------- helpers

const clone = (s: State): State => structuredClone(s);

function view(st: State, p: number): View {
  const d = st.devices[p]!;
  return {
    s: d.s,
    job: d.job,
    boot: d.boot,
    runs: d.runs,
    pauseReason: d.pauseReason,
    pausedFromPrep: d.pausedFromPrep,
    files: [...d.files],
    pendingStarts: st.daemon.transfers.filter((t) => t.p === p).map((t) => t.job),
    endRecords: st.daemon.outbox
      .filter((m) => m.p === p && m.job !== undefined && (m.kind === "finished" || m.kind === "failed" || m.kind === "cancelled"))
      .map((m) => ({ job: m.job!, kind: m.kind as "finished" | "failed" | "cancelled", beforeStart: !!m.beforeStart, fromPrinter: !!m.fromPrinter })),
  };
}

const add = (xs: number[], x: number) => {
  if (!xs.includes(x)) xs.push(x);
};

class Ctx {
  findings: Finding[] = [];
  st: State;
  constructor(st: State) {
    this.st = st;
  }
  find(kind: FindingKind, detail: string) {
    this.findings.push({ kind, detail });
  }
  setOrder(o: number, trigger: OrderTrigger) {
    const ord = this.st.orders[o]!;
    const row = ORDER_TRANSITIONS[trigger];
    if (!(row.from as readonly OrderState[]).includes(ord.s)) {
      this.find("orderTransitionNotInTable", `${trigger}: order ${ord.s} → ${row.to}`);
    }
    ord.s = row.to;
  }
  setPrinter(p: number, trigger: PrinterTrigger) {
    const pr = this.st.printers[p]!;
    const row = PRINTER_TRANSITIONS[trigger];
    if (!(row.from as readonly PrinterState[]).includes(pr.s)) {
      this.find("printerTransitionNotInTable", `${trigger}: printer ${pr.s} → ${row.to}`);
    }
    pr.s = row.to;
  }
  setJob(j: number, trigger: JobTrigger) {
    const job = this.st.jobs[j]!;
    const row = JOB_TRANSITIONS[trigger];
    if (!(row.from as readonly JobPhase[]).includes(job.phase)) {
      this.find("jobTransitionNotInTable", `${trigger}: job ${job.phase} → ${row.to}`);
    }
    job.phase = row.to;
  }
}

const current = (st: State, j: number | undefined): Job | null => {
  if (j === undefined) return null;
  const job = st.jobs[j];
  return job && job.phase !== "ENDED" ? job : null;
};

const has = (pr: Printer, reason: FaultReason) => pr.faults.includes(reason);

/** The panel believes something is running on the printer. */
const busy = (pr: Printer) => pr.busyWithOther || (pr.job !== null && !has(pr, "NEEDS_JUDGEMENT"));

function raiseFault(c: Ctx, p: number, reason: FaultReason) {
  const pr = c.st.printers[p]!;
  if (has(pr, reason)) return;
  pr.faults.push(reason);
  pr.faults.sort();
  if (pr.s !== "FAULT") c.setPrinter(p, "faultRaised");
}

/** Removes a fault reason. With none left the printer goes back to work if it reports something running, else it needs clearing. */
function dropFault(c: Ctx, p: number, reason: FaultReason) {
  const pr = c.st.printers[p]!;
  if (!has(pr, reason)) return;
  pr.faults = pr.faults.filter((f) => f !== reason);
  if (pr.faults.length === 0) c.setPrinter(p, busy(pr) ? "printerResumed" : "faultsCleared");
}

/** The panel learns the printer is running something other than its current job. */
function otherJobRunning(c: Ctx, p: number) {
  const pr = c.st.printers[p]!;
  pr.busyWithOther = true;
  if (pr.s === "AVAILABLE" || pr.s === "CLEARING_REQUIRED") c.setPrinter(p, "printerRunning");
}

/** Nothing is running any more as far as the panel knows. */
function workMayHaveEnded(c: Ctx, p: number) {
  const pr = c.st.printers[p]!;
  if (pr.s === "WORKING" && !busy(pr)) c.setPrinter(p, "workEnded");
}

// ---------------------------------------------------------------- panel: job end

/** Ends a job and applies its effect on order and printer in one go. */
function endJob(c: Ctx, j: number, outcome: JobOutcome, why: string, byDaemon = false) {
  const st = c.st;
  const job = st.jobs[j]!;
  const ord = st.orders[job.order]!;
  const pr = st.printers[job.printer]!;
  const printed = st.truth.printed.includes(j);
  const finished = st.truth.finished.includes(j);
  const contradicts =
    (outcome === "FINISHED" && !finished) ||
    (outcome === "FAILED" && (!printed || finished)) ||
    ((outcome === "STOPPED_BEFORE_START" || outcome === "START_FAILED" || outcome === "SEND_FAILED") && printed);
  if (contradicts) {
    c.find(
      "outcomeContradictsPrinter",
      `${why}: job ended ${outcome} but the printer ${finished ? "finished it" : printed ? "had started printing it" : "never started printing it"}`,
    );
  }
  c.setJob(j, "ended");
  job.outcome = outcome;
  const effect = jobEndEffect(outcome);
  c.setOrder(job.order, effect.order);
  ord.job = null;
  ord.lastPrinter = job.printer;
  pr.job = null;
  // Unless the daemon itself said the job is over, it is told, so that it can never start it later.
  if (st.opts.panelTellsDaemonWhenJobEnds && !byDaemon && outcome !== "FINISHED" && !st.daemon.inbox.some((x) => x.kind === "stop" && x.job === j)) {
    st.daemon.inbox.push({ p: job.printer, kind: "stop", job: j, expired: false });
  }
  if (effect.raiseSendFailed) raiseFault(c, job.printer, "SEND_FAILED");
  dropFault(c, job.printer, "PRINTER_ERROR");
  dropFault(c, job.printer, "NEEDS_JUDGEMENT");
  workMayHaveEnded(c, job.printer);
}

function startPrinting(c: Ctx, j: number) {
  const job = c.st.jobs[j]!;
  c.setJob(j, "printerStarted");
  job.pausedFrom = null;
  c.setOrder(job.order, "printerStarted");
}

function pauseJob(c: Ctx, j: number, reason: "USER" | "ERROR" | null) {
  const job = c.st.jobs[j]!;
  const from = job.phase as "PREPARING" | "PRINTING";
  c.setJob(j, "printerPaused");
  job.pausedFrom = from;
  if (reason === "ERROR") raiseFault(c, job.printer, "PRINTER_ERROR");
}

function resumeJob(c: Ctx, j: number) {
  const job = c.st.jobs[j]!;
  c.setJob(j, job.pausedFrom === "PRINTING" ? "printerResumedPrinting" : "printerResumedPreparing");
  job.pausedFrom = null;
  dropFault(c, job.printer, "PRINTER_ERROR");
}

function endFromEvent(c: Ctx, j: number, kind: "finished" | "failed" | "cancelled", beforeStart: boolean, why: string) {
  const outcome: JobOutcome =
    kind === "finished" ? "FINISHED" : kind === "failed" ? (beforeStart ? "START_FAILED" : "FAILED") : beforeStart ? "STOPPED_BEFORE_START" : "FAILED";
  endJob(c, j, outcome, why, true);
}

/** The printer reports the current job running: follow it, whatever the panel had recorded. */
function followRunningJob(c: Ctx, j: number, v: View) {
  const job = c.st.jobs[j]!;
  const ord = c.st.orders[job.order]!;
  if ((v.s === "PREPARING" || (v.s === "PAUSED" && v.pausedFromPrep)) && (job.phase === "TRANSFERRING" || job.phase === "PREPARING")) {
    job.prepared = true;
    c.setJob(j, "printerReportedPreparing");
  }
  if ((v.s === "PRINTING" || (v.s === "PAUSED" && !v.pausedFromPrep)) && ord.s === "DISPATCHED") startPrinting(c, j);
  if (v.s === "PAUSED" && job.phase !== "PAUSED") pauseJob(c, j, v.pauseReason);
  if (v.s !== "PAUSED" && job.phase === "PAUSED") resumeJob(c, j);
  // Seeing the job run answers the question of what became of it.
  dropFault(c, job.printer, "NEEDS_JUDGEMENT");
}

// ---------------------------------------------------------------- panel: messages

function handle(c: Ctx, m: Msg) {
  const st = c.st;
  const pr = st.printers[m.p]!;
  const printerEvent = !["startAccepted", "staged", "startRejectedBusy", "startFailed", "startExpired", "snapshot", "connectionUp", "connectionDown"].includes(m.kind) && m.fromPrinter !== false;
  const connectionEvent = m.kind === "connectionUp" || m.kind === "connectionDown";
  // Printer events older than the reconnect snapshot are dropped: the snapshot is the newer fact.
  if (m.olderThanSnapshot && (printerEvent || connectionEvent)) return;
  if (!m.olderThanSnapshot || m.kind === "snapshot") pr.last = m.view;
  const j = m.job;
  const job = current(st, j);
  const isEnded = j !== undefined && st.jobs[j]?.phase === "ENDED";

  switch (m.kind) {
    case "connectionDown":
      pr.connected = false;
      raiseFault(c, m.p, "UNREACHABLE");
      return;
    case "connectionUp":
      reconcile(c, m.p, m.view);
      return;
    case "snapshot":
      if (!pr.connected) {
        reconcile(c, m.p, m.view);
        return;
      }
      if (typeof m.view.job === "number" && running(m.view.s)) {
        const vj = m.view.job;
        if (current(st, vj)) followRunningJob(c, vj, m.view);
        else if (st.jobs[vj]?.phase === "ENDED") otherJobRunning(c, m.p);
      }
      return;
    case "startAccepted":
      if (job) job.startAccepted = true;
      return;
    case "staged":
      if (job && job.phase === "TRANSFERRING") {
        job.staged = true;
        c.setJob(j!, "fileStaged");
      }
      return;
    case "started":
      if (job) {
        if (job.phase !== "PRINTING" && !(job.phase === "PAUSED" && job.pausedFrom === "PRINTING")) startPrinting(c, j!);
        dropFault(c, m.p, "NEEDS_JUDGEMENT");
      } else if (isEnded) otherJobRunning(c, m.p);
      return;
    case "paused":
      if (job && (job.phase === "PREPARING" || job.phase === "PRINTING")) pauseJob(c, j!, m.view.pauseReason);
      return;
    case "resumed":
      if (job && job.phase === "PAUSED") resumeJob(c, j!);
      return;
    case "finished":
    case "failed":
    case "cancelled":
      // The printer (or the daemon, for a transfer it aborted) says the job is over: a fact, whatever phase the panel had.
      if (job) endFromEvent(c, j!, m.kind, !!m.beforeStart, `event ${m.kind}`);
      else if (isEnded && pr.busyWithOther && !running(pr.last.s)) {
        pr.busyWithOther = false;
        workMayHaveEnded(c, m.p);
      }
      return;
    case "startRejectedBusy":
    case "startFailed":
    case "startExpired":
      if (job && job.phase === "TRANSFERRING") endJob(c, j!, "SEND_FAILED", m.kind, true);
      return;
    case "externalStarted":
      // If a job of ours is still being transferred, the daemon will find the printer busy and refuse the start itself.
      otherJobRunning(c, m.p);
      return;
    case "externalEnded":
      pr.busyWithOther = false;
      workMayHaveEnded(c, m.p);
      return;
  }
}

/**
 * Reconnect. Three rows for a printer that holds a job:
 *   1. the same job is still under way (running on the printer, or the start not sent yet): carry on;
 *   2. the printer or the daemon says how the job ended: take that;
 *   3. anything else: a person judges the job.
 * Without a job the printer is working if it runs something, else it needs clearing.
 */
function reconcile(c: Ctx, p: number, v: View) {
  const st = c.st;
  const pr = st.printers[p]!;
  const j = pr.job;
  const job = j === null ? null : st.jobs[j]!;
  pr.connected = true;
  pr.busyWithOther = running(v.s) && v.job !== j;
  if (job && j !== null) {
    const rec = v.endRecords.find((r) => r.job === j);
    const seenPrinting = job.phase === "PRINTING" || (job.phase === "PAUSED" && job.pausedFrom === "PRINTING");
    if (rec) {
      // 2. The daemon recorded the end.
      endFromEvent(c, j, rec.kind, rec.beforeStart, "reconcile: end record");
    } else if (v.job === j && running(v.s)) {
      // 1. Still running.
      followRunningJob(c, j, v);
    } else if (v.pendingStarts.includes(j) || (!job.startAccepted && (job.startDeliveredIn === null || job.startDeliveredIn === st.daemon.epoch))) {
      // 1. The daemon still holds the start, or the start command hasn't reached it yet (the snapshot may predate it).
    } else if (v.job === j && (v.s === "FINISHED" || (v.s === "FAILED" && seenPrinting))) {
      // 2. The printer's last job is this one and it stopped at finished or failed. A failure of a job the panel
      // never saw printing may have happened before the start, so that one is left to a person.
      endJob(c, j, v.s === "FINISHED" ? "FINISHED" : "FAILED", `reconcile: printer stopped at ${v.s}`, true);
    } else {
      // 3. Nothing says what became of it.
      raiseFault(c, p, "NEEDS_JUDGEMENT");
    }
  }
  dropFault(c, p, "UNREACHABLE");
  // A person may have judged its job and released it while it was away.
  if (pr.s === "CLEARING_REQUIRED" && busy(pr)) c.setPrinter(p, "printerRunning");
  workMayHaveEnded(c, p);
}

// ---------------------------------------------------------------- device and daemon

/** The daemon reports a device change it observed (only while it can reach the printer). */
function emit(st: State, p: number, kind: MsgKind, extra: Partial<Msg> = {}) {
  const msg: Msg = { p, kind, ...extra, view: view(st, p) };
  // Snapshots are not kept for resending: while the panel link is down they are dropped.
  if (kind === "snapshot" && !st.daemon.link) return;
  st.daemon.outbox.push(msg);
  // Refresh the end-record list of the newest message so the next snapshot sees it.
  msg.view = view(st, p);
}

function deviceChanged(st: State, p: number, kind: MsgKind | null, extra: Partial<Msg> = {}) {
  if (kind && st.devices[p]!.reachable) emit(st, p, kind, extra);
}

function deviceEnd(st: State, p: number, end: "FINISHED" | "FAILED" | "CANCELLED") {
  const d = st.devices[p]!;
  const job = d.job;
  const beforeStart = !d.printed;
  d.s = end;
  d.pauseReason = null;
  d.pausedFromPrep = false;
  if (job === "EXT") deviceChanged(st, p, "externalEnded");
  else if (typeof job === "number") {
    if (end === "FINISHED") add(st.truth.finished, job);
    // The daemon deletes its own file once it saw the job end.
    if (d.reachable) d.files = d.files.filter((f) => f !== job);
    deviceChanged(st, p, end === "FINISHED" ? "finished" : end === "FAILED" ? "failed" : "cancelled", { job, beforeStart, fromPrinter: true });
  }
}

function deviceStartSystemJob(c: Ctx, p: number, j: number) {
  const st = c.st;
  const d = st.devices[p]!;
  const isCurrent = current(st, j) !== null;
  if (d.plateDirty && isCurrent) c.find("systemPrintOnUnclearedPlate", `printer began job ${j} on a plate nobody cleared`);
  d.runs++;
  d.s = "PREPARING";
  d.job = j;
  d.printed = false;
  d.pausedFromPrep = false;
  d.pauseReason = null;
  d.plateDirty = true;
  add(st.truth.prepared, j);
  deviceChanged(st, p, "snapshot");
}

// ---------------------------------------------------------------- actions

type Act = { label: string; cls: ActionClass; budget?: keyof Budget; run: (c: Ctx) => void };

function actions(st: State): Act[] {
  const acts: Act[] = [];
  const A = (label: string, cls: ActionClass, run: (c: Ctx) => void, budget?: keyof Budget) => {
    if (budget && st.budget[budget] <= 0) return;
    acts.push(budget ? { label, cls, run, budget } : { label, cls, run });
  };
  const anyActive = st.orders.some((o) => o.s === "DISPATCHED" || o.s === "PRINTING");

  // ---- people: orders
  st.orders.forEach((o, i) => {
    if (o.s === "PENDING_REVIEW") {
      A(`approve order ${i}`, "human", (c) => {
        c.st.orders[i]!.hasSortValue = true;
        c.setOrder(i, "approve");
      });
      if (!o.hasSortValue) A(`reject order ${i}`, "human", (c) => c.setOrder(i, "rejectNewSubmission"));
      else A(`withdraw revision of order ${i}`, "human", (c) => c.setOrder(i, "withdrawRevision"));
    }
    if (o.s === "QUEUED" && o.revisions < MAX_REVISIONS && o.userActive) {
      A(
        `revise order ${i}`,
        "human",
        (c) => {
          c.st.orders[i]!.revisions++;
          c.setOrder(i, "reviseFile");
        },
        "revisions",
      );
    }
    if (o.s === "PENDING_REVIEW" || o.s === "QUEUED") A(`cancel order ${i}`, "human", (c) => c.setOrder(i, "cancel"));
    if (o.s === "QUEUED") {
      st.printers.forEach((pr, p) => {
        if (pr.s !== "AVAILABLE") return;
        A(
          `dispatch order ${i} to printer ${p}`,
          "human",
          (c) => {
            const s = c.st;
            const j = s.jobs.length;
            s.jobs.push({ order: i, printer: p, phase: "TRANSFERRING", outcome: null, pausedFrom: null, seenRuns: s.printers[p]!.last.runs, startAccepted: false, startDeliveredIn: null, staged: false, prepared: false, stopSent: false });
            s.orders[i]!.job = j;
            s.printers[p]!.job = j;
            c.setOrder(i, "dispatch");
            c.setPrinter(p, "dispatch");
            s.daemon.inbox.push({ p, kind: "start", job: j, seenRuns: s.printers[p]!.last.runs, expired: false });
          },
          "dispatches",
        );
      });
    }
    if (o.s === "FAILED") {
      if (!o.noReprint && !o.archived && !o.fileExpired && o.userActive) A(`reprint order ${i}`, "human", (c) => c.setOrder(i, "reprint"));
      if (!o.noReprint && !o.archived) A(`mark order ${i} no-reprint`, "human", (c) => void (c.st.orders[i]!.noReprint = true));
      if (o.noReprint && !o.archived) A(`undo no-reprint on order ${i}`, "human", (c) => void (c.st.orders[i]!.noReprint = false));
      if (!o.fileExpired) A(`file of order ${i} expires`, "adverse", (c) => void (c.st.orders[i]!.fileExpired = true), "fileExpiries");
    }
    if (o.s === "PRINTED") {
      A(`store order ${i}`, "human", (c) => {
        const s = c.st;
        c.setOrder(i, "store");
        const p = s.orders[i]!.lastPrinter!;
        if (s.printers[p]!.s === "CLEARING_REQUIRED") {
          c.setPrinter(p, "plateCleared");
          if (!running(s.devices[p]!.s)) s.devices[p]!.plateDirty = false;
        }
      });
    }
    if (o.s === "READY_FOR_PICKUP") {
      A(`pick up order ${i}`, "human", (c) => c.setOrder(i, "pickUp"));
      A(`dispose order ${i}`, "human", (c) => c.setOrder(i, "dispose"));
    }
    if (o.userActive) {
      A(
        `deactivate owner of order ${i}`,
        "human",
        (c) => {
          const ord = c.st.orders[i]!;
          ord.userActive = false;
          if (ord.s === "PENDING_REVIEW" || ord.s === "QUEUED") c.setOrder(i, "cancel");
        },
        "deactivations",
      );
    }
  });
  if (!anyActive) {
    A(
      "archive the event",
      "human",
      (c) => {
        c.st.orders.forEach((o, i) => {
          if (o.s === "PENDING_REVIEW" || o.s === "QUEUED") c.setOrder(i, "archiveCancels");
          else if (o.s === "PRINTED" || o.s === "READY_FOR_PICKUP") c.setOrder(i, "dispose");
          else if (o.s === "FAILED") o.archived = true;
        });
      },
      "archives",
    );
  }

  // ---- people: printers
  st.printers.forEach((pr, p) => {
    const job = current(st, pr.job ?? undefined);
    const j = pr.job;
    const pending = (kind: CmdKind) => st.daemon.inbox.some((c) => c.p === p && c.kind === kind && c.job === (j ?? undefined));
    const reportsRunning = pr.connected && running(pr.last.s);
    if (job && j !== null && !pending("stop")) {
      A(`stop job on printer ${p}`, "human", (c) => {
        c.st.jobs[j]!.stopSent = true;
        c.st.daemon.inbox.push({ p, kind: "stop", job: j, expired: false });
      });
    }
    // Whatever else runs on it (external job, test print in maintenance, a job that had already ended) can be stopped too.
    if (pr.busyWithOther && pr.connected && !st.daemon.inbox.some((c) => c.p === p && c.kind === "stopExternal")) {
      A(`stop what runs on printer ${p}`, "human", (c) => void c.st.daemon.inbox.push({ p, kind: "stopExternal", expired: false }));
    }
    if (job && j !== null && job.phase === "PAUSED" && !pending("resume")) {
      A(`resume printer ${p}`, "human", (c) => void c.st.daemon.inbox.push({ p, kind: "resume", job: j, expired: false }));
    }
    // "Start may not have arrived": a stop was sent and neither the printer nor the daemon said anything.
    // After a refresh that still shows nothing running, a person has to judge. A start still on its way at
    // that point is the rare slow case and is budgeted like a fault.
    if (job && j !== null && job.phase === "PREPARING" && job.staged && !job.prepared && job.stopSent && !pending("stop") && pr.connected && st.daemon.link && st.devices[p]!.reachable && !st.daemon.outbox.some((m) => m.p === p) && !has(pr, "NEEDS_JUDGEMENT")) {
      const d = st.devices[p]!;
      const slow = d.lanStart !== null || d.lanStop;
      A(`refresh after stopping a start that may not have arrived on printer ${p}${slow ? " (commands still on their way)" : ""}`, "human", (c) => {
        const s = c.st;
        const v = view(s, p);
        s.printers[p]!.last = v;
        if (!running(v.s)) raiseFault(c, p, "NEEDS_JUDGEMENT");
      }, slow ? "slowCommands" : undefined);
    }
    // A person judges the job of a faulted printer: failed, finished or never started. Not while the printer
    // reports something running. Needed when nothing says how the job ended; also allowed for any other fault
    // without waiting for the printer to come back, which the rules must never depend on.
    if (job && j !== null && pr.s === "FAULT" && !reportsRunning) {
      const needed = has(pr, "NEEDS_JUDGEMENT");
      const caughtUp = !(st.daemon.link && st.daemon.outbox.some((m) => m.p === p));
      if (caughtUp || !needed) {
        const truthPrinted = st.truth.printed.includes(j);
        const truthFinished = st.truth.finished.includes(j);
        // They look at the machine and judge what they see.
        const outcome: JobOutcome = !truthPrinted ? JUDGEMENTS.notStarted : truthFinished ? JUDGEMENTS.finished : JUDGEMENTS.failed;
        const slowJudge = st.devices[p]!.lanStart !== null || st.devices[p]!.lanStop;
        A(
          `staff judge printer ${p} job ${outcome}${needed ? "" : " (released without waiting)"}${slowJudge ? " (commands still on their way)" : ""}`,
          needed ? "human" : "backstop",
          (c) => endJob(c, j, outcome, "staff judgement"),
          needed ? (slowJudge ? "slowCommands" : undefined) : "releases",
        );
      }
    }
    if (has(pr, "SEND_FAILED")) A(`mark SEND_FAILED handled on printer ${p}`, "human", (c) => dropFault(c, p, "SEND_FAILED"));
    if (pr.s === "CLEARING_REQUIRED" && pr.job === null && !st.orders.some((o) => o.s === "PRINTED" && o.lastPrinter === p)) {
      A(`confirm plate cleared on printer ${p}`, "human", (c) => {
        c.setPrinter(p, "plateCleared");
        if (!running(c.st.devices[p]!.s)) c.st.devices[p]!.plateDirty = false;
      });
    }
    if (pr.job === null && !has(pr, "MAINTENANCE") && pr.s !== "WORKING") A(`start maintenance on printer ${p}`, "human", (c) => raiseFault(c, p, "MAINTENANCE"));
    if (has(pr, "MAINTENANCE")) A(`end maintenance on printer ${p}`, "human", (c) => dropFault(c, p, "MAINTENANCE"));
  });

  // ---- world: message delivery
  const dm = st.daemon;
  if (dm.link && dm.outbox.length > 0) {
    A("panel processes next daemon message", "benign", (c) => handle(c, c.st.daemon.outbox.shift()!));
  }
  if (dm.link && dm.inbox.length > 0) {
    A("daemon receives next panel command", "benign", (c) => {
      const cmd = c.st.daemon.inbox.shift()!;
      if (cmd.kind === "start") c.st.jobs[cmd.job!]!.startDeliveredIn = c.st.daemon.epoch;
      daemonCommand(c, cmd);
    });
  }
  dm.inbox.forEach((cmd, k) => {
    if (!cmd.expired && (cmd.kind === "start" || cmd.kind === "stop")) {
      A(`panel command ${k} (${cmd.kind}) expires before delivery`, "adverse", (c) => void (c.st.daemon.inbox[k]!.expired = true), "expiries");
    }
  });
  if (!dm.link) {
    A("panel link restored", "benign", (c) => {
      const s = c.st;
      s.daemon.link = true;
      s.daemon.epoch++;
      // On reconnect the daemon sends a fresh snapshot of every printer before resending its outbox.
      const first: Msg[] = s.devices.map((d, p) => ({ p, kind: d.reachable ? "snapshot" : "connectionDown", view: view(s, p) }));
      for (const m of s.daemon.outbox) m.olderThanSnapshot = true;
      s.daemon.outbox.unshift(...first);
    });
  } else {
    A(
      "panel link drops",
      "adverse",
      (c) => {
        const s = c.st;
        s.daemon.link = false;
        s.printers.forEach((pr, p) => {
          pr.connected = false;
          raiseFault(c, p, "UNREACHABLE");
        });
        // Snapshots in flight are not resent.
        s.daemon.outbox = s.daemon.outbox.filter((m) => m.kind !== "snapshot");
      },
      "linkDrops",
    );
  }
  A(
    "daemon restarts and loses its local state",
    "adverse",
    (c) => {
      const s = c.st;
      s.daemon.outbox = [];
      s.daemon.transfers = [];
      s.daemon.neverStart = [];
      s.daemon.staged = [];
      s.daemon.cache = [];
      if (s.daemon.link) {
        s.daemon.link = false;
        s.printers.forEach((pr, p) => {
          pr.connected = false;
          raiseFault(c, p, "UNREACHABLE");
        });
      }
    },
    "daemonWipes",
  );

  // ---- world: transfers
  dm.transfers.forEach((t, k) => {
    if (st.devices[t.p]!.reachable) {
      A(`transfer of job ${t.job} completes`, "benign", (c) => {
        const s = c.st;
        s.daemon.transfers.splice(k, 1);
        const d = s.devices[t.p]!;
        if (running(d.s) || (s.opts.daemonChecksPrinterUnused && (t.printerWasUsed || d.runs !== t.seenRuns))) {
          emit(s, t.p, "startRejectedBusy", { job: t.job });
          return;
        }
        add(d.files, t.job);
        s.daemon.staged = s.daemon.staged.filter((x) => x.p !== t.p);
        s.daemon.staged.push({ job: t.job, p: t.p, runs: d.runs, watched: true });
        d.lanStart = t.job;
        emit(s, t.p, "staged", { job: t.job });
      });
    }
    A(
      `transfer of job ${t.job} fails`,
      "adverse",
      (c) => {
        c.st.daemon.transfers.splice(k, 1);
        emit(c.st, t.p, "startFailed", { job: t.job });
      },
      "transferFailures",
    );
  });

  // ---- world: devices
  st.devices.forEach((d, p) => {
    if (d.reachable) {
      A(`printer ${p} drops off the LAN`, "adverse", (c) => {
        c.st.devices[p]!.reachable = false;
        for (const t of c.st.daemon.transfers) if (t.p === p) t.printerWasUsed = true;
        for (const x of c.st.daemon.staged) if (x.p === p) x.watched = false;
        emit(c.st, p, "connectionDown");
      }, "lanDrops");
    } else {
      A(`printer ${p} back on the LAN`, "benign", (c) => {
        c.st.devices[p]!.reachable = true;
        emit(c.st, p, "connectionUp");
      });
      A(
        `printer ${p} reboots while unreachable`,
        "adverse",
        (c) => {
          const dv = c.st.devices[p]!;
          dv.boot++;
          dv.s = "IDLE";
          dv.printed = false;
          dv.pausedFromPrep = false;
          dv.pauseReason = null;
          dv.lanStart = null;
          dv.lanStop = false;
          dv.lanResume = false;
        },
        "reboots",
      );
    }
    if (d.lanStart !== null) {
      const j = d.lanStart;
      A(`printer ${p} acts on start of job ${j}`, "benign", (c) => {
        const dv = c.st.devices[p]!;
        dv.lanStart = null;
        // Without its file on storage the printer has nothing to print.
        if (!running(dv.s) && dv.files.includes(j)) deviceStartSystemJob(c, p, j);
      });
      A(`start of job ${j} never reaches printer ${p}`, "adverse", (c) => void (c.st.devices[p]!.lanStart = null), "lostStarts");
    }
    if (d.lanStop) {
      A(`printer ${p} acts on stop`, "benign", (c) => {
        const dv = c.st.devices[p]!;
        dv.lanStop = false;
        if (running(dv.s)) deviceEnd(c.st, p, "CANCELLED");
      });
    }
    if (d.lanResume) {
      A(`printer ${p} acts on resume`, "benign", (c) => {
        const dv = c.st.devices[p]!;
        dv.lanResume = false;
        if (dv.s === "PAUSED") deviceResume(c.st, p);
      });
    }
    if (d.s === "PREPARING") {
      A(`printer ${p} starts printing`, "benign", (c) => {
        const s = c.st;
        const dv = s.devices[p]!;
        dv.s = "PRINTING";
        dv.printed = true;
        if (typeof dv.job === "number") {
          add(s.truth.printed, dv.job);
          deviceChanged(s, p, "started", { job: dv.job });
        }
      });
    }
    if (d.s === "PRINTING") A(`printer ${p} finishes`, "benign", (c) => deviceEnd(c.st, p, "FINISHED"));
    if ((d.s === "PREPARING" || d.s === "PRINTING") && d.job !== "EXT") {
      for (const reason of ["USER", "ERROR"] as const) {
        A(
          `printer ${p} pauses (${reason})`,
          "adverse",
          (c) => {
            const s = c.st;
            const dv = s.devices[p]!;
            dv.pausedFromPrep = dv.s === "PREPARING";
            dv.s = "PAUSED";
            dv.pauseReason = reason;
            if (typeof dv.job === "number") deviceChanged(s, p, "paused", { job: dv.job });
          },
          "pauses",
        );
      }
    }
    if (d.s === "PAUSED") A(`someone resumes printer ${p} on its screen`, "adverse", (c) => deviceResume(c.st, p), "screenResumes");
    if (running(d.s)) {
      A(`printer ${p} fails`, "adverse", (c) => deviceEnd(c.st, p, "FAILED"), "deviceFailures");
      A(`someone stops printer ${p} on its screen`, "adverse", (c) => deviceEnd(c.st, p, "CANCELLED"), "screenStops");
    } else if (d.lanStart === null) {
      A(
        `someone starts an external job on printer ${p}`,
        "adverse",
        (c) => {
          const dv = c.st.devices[p]!;
          dv.runs++;
          dv.s = "PRINTING";
          dv.job = "EXT";
          dv.printed = true;
          dv.plateDirty = true;
          deviceChanged(c.st, p, "externalStarted");
        },
        "externalStarts",
      );
    }
  });
  return acts;
}

function deviceResume(st: State, p: number) {
  const d = st.devices[p]!;
  d.s = d.pausedFromPrep ? "PREPARING" : "PRINTING";
  d.pausedFromPrep = false;
  d.pauseReason = null;
  if (typeof d.job === "number") deviceChanged(st, p, "resumed", { job: d.job });
}

function daemonCommand(c: Ctx, cmd: Cmd) {
  const st = c.st;
  const d = st.devices[cmd.p]!;
  if (cmd.expired) {
    if (cmd.kind === "start") emit(st, cmd.p, "startExpired", { job: cmd.job! });
    return;
  }
  switch (cmd.kind) {
    case "start":
      if (st.daemon.neverStart.includes(cmd.job!)) return;
      {
        // The panel only serves the file for a job that hasn't ended; a cached copy needs no download.
        const job = st.jobs[cmd.job!]!;
        if (job.phase === "ENDED" && !st.daemon.cache.includes(job.order)) {
          emit(st, cmd.p, "startFailed", { job: cmd.job! });
          return;
        }
        add(st.daemon.cache, job.order);
        emit(st, cmd.p, "startAccepted", { job: cmd.job! });
        st.daemon.transfers.push({ p: cmd.p, job: cmd.job!, seenRuns: cmd.seenRuns!, printerWasUsed: !d.reachable });
      }
      return;
    case "stop": {
      const k = st.daemon.transfers.findIndex((t) => t.job === cmd.job);
      if (k >= 0) {
        st.daemon.transfers.splice(k, 1);
        add(st.daemon.neverStart, cmd.job!);
        emit(st, cmd.p, "cancelled", { job: cmd.job!, beforeStart: true, fromPrinter: false });
        return;
      }
      const sg = st.daemon.staged.find((x) => x.job === cmd.job);
      if (st.opts.daemonConfirmsStopOfUnstartedJob && d.reachable && sg && sg.watched && sg.runs === d.runs) {
        // The printer shows no sign of ever having taken this job: the daemon removes the staged
        // file, promises never to start it and says so, exactly as it does during a transfer.
        d.files = d.files.filter((f) => f !== cmd.job);
        if (d.lanStart === cmd.job) d.lanStart = null;
        if (st.daemon.neverStart.includes(cmd.job!)) return; // already said so
        add(st.daemon.neverStart, cmd.job!);
        emit(st, cmd.p, "cancelled", { job: cmd.job!, beforeStart: true, fromPrinter: false });
        return;
      }
      // Stop goes to the printer when it runs this job, or when it is idle (harmless).
      // It is not sent when the printer runs something else.
      if (d.reachable && (d.job === cmd.job || !running(d.s))) d.lanStop = true;
      return;
    }
    case "stopExternal":
      if (d.reachable && running(d.s)) d.lanStop = true;
      return;
    case "resume":
      if (d.reachable && d.s === "PAUSED") d.lanResume = true;
      return;
  }
}

export function successors(st: State): Step[] {
  return actions(st).map((a) => {
    const next = clone(st);
    if (a.budget) next.budget[a.budget]--;
    const c = new Ctx(next);
    a.run(c);
    return { label: a.label, cls: a.cls, next, findings: c.findings };
  });
}

// ---------------------------------------------------------------- properties

/** Structural invariants that must hold in every reachable state. */
export function invariantViolations(st: State): string[] {
  const out: string[] = [];
  st.printers.forEach((pr, p) => {
    if ((pr.s === "FAULT") !== pr.faults.length > 0) out.push(`printer ${p} is ${pr.s} with faults [${pr.faults.join(",")}]`);
    if (!pr.connected && !has(pr, "UNREACHABLE")) out.push(`printer ${p} can't be reached but isn't flagged`);
    if (pr.s === "AVAILABLE" && (pr.job !== null || pr.busyWithOther)) out.push(`printer ${p} is available while something runs on it`);
    if (pr.s === "CLEARING_REQUIRED" && busy(pr)) out.push(`printer ${p} needs clearing while something runs on it`);
    if (pr.s === "WORKING" && !busy(pr)) out.push(`printer ${p} is working with nothing running`);
    if (pr.job !== null) {
      const job = st.jobs[pr.job]!;
      if (job.phase === "ENDED") out.push(`printer ${p} still points at ended job ${pr.job}`);
      if (job.printer !== p) out.push(`printer ${p} points at job of printer ${job.printer}`);
    } else if (has(pr, "NEEDS_JUDGEMENT")) out.push(`printer ${p} waits for a judgement without a job`);
  });
  st.orders.forEach((o, i) => {
    const active = o.s === "DISPATCHED" || o.s === "PRINTING";
    if (active !== (o.job !== null)) out.push(`order ${i} is ${o.s} with job ${o.job}`);
    if (o.job !== null) {
      const job = st.jobs[o.job]!;
      if (job.phase === "ENDED") out.push(`order ${i} points at ended job`);
      const printingPhase = job.phase === "PRINTING" || (job.phase === "PAUSED" && job.pausedFrom === "PRINTING");
      if ((o.s === "PRINTING") !== printingPhase) out.push(`order ${i} ${o.s} but job ${job.phase}/${job.pausedFrom}`);
      if (st.printers[job.printer]!.job !== o.job) out.push(`order ${i} job not current on its printer`);
    }
  });
  return out;
}

/**
 * When nothing is in flight (links up, queues empty, no commands pending on
 * the LAN), the panel must agree with the printer.
 */
export function quiescentMismatch(st: State): string[] {
  const dm = st.daemon;
  if (!dm.link || dm.outbox.length || dm.inbox.length || dm.transfers.length) return [];
  const out: string[] = [];
  st.printers.forEach((pr, p) => {
    const d = st.devices[p]!;
    if (!d.reachable || d.lanStart !== null || d.lanStop || d.lanResume) return;
    if (has(pr, "NEEDS_JUDGEMENT")) return; // waiting for a person
    if (has(pr, "UNREACHABLE")) out.push(`printer ${p} still flagged unreachable with everything delivered`);
    const r = running(d.s);
    if ((pr.s === "AVAILABLE" || pr.s === "CLEARING_REQUIRED") && r) out.push(`panel ${pr.s} but printer ${p} is running ${d.job}`);
    if (pr.busyWithOther && !r) out.push(`panel shows another job running but printer ${p} is ${d.s}`);
    const job = pr.job === null ? null : st.jobs[pr.job]!;
    if (job && (job.phase === "PRINTING" || job.phase === "PAUSED") && !(r && d.job === pr.job)) out.push(`panel job ${pr.job} ${job.phase} but printer ${p} ${d.s} ${d.job}`);
  });
  return out;
}

const SETTLED: readonly OrderState[] = [...TERMINAL_ORDER_STATES, "FAILED"];

/** Everything has come to rest: orders settled, printers available. */
export function settled(st: State): boolean {
  return st.orders.every((o) => SETTLED.includes(o.s)) && st.printers.every((pr) => pr.s === "AVAILABLE");
}

export const printedOrBeyond = (o: Order) => o.s === "PRINTED" || o.s === "READY_FOR_PICKUP" || o.s === "COMPLETED";

export function describe(st: State): string {
  const o = st.orders.map((x, i) => `order${i}=${x.s}${x.job !== null ? `(job${x.job})` : ""}`).join(" ");
  const p = st.printers
    .map((x, i) => `printer${i}=${x.s}${x.job !== null ? `(job${x.job})` : ""}${x.busyWithOther ? "+other" : ""}${x.faults.map((f) => `+${f}`).join("")}`)
    .join(" ");
  const d = st.devices.map((x, i) => `device${i}=${x.s}/${x.job}${x.reachable ? "" : "/unreachable"}${x.plateDirty ? "/dirty" : ""}`).join(" ");
  return `${o} | ${p} | ${d} | link=${st.daemon.link ? "up" : "down"} outbox=${st.daemon.outbox.length} inbox=${st.daemon.inbox.length}`;
}
