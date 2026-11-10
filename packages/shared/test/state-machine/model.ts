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
  type AttentionReason,
  type JobOutcome,
  type JobPhase,
  type OrderState,
  type OrderTrigger,
  type PrinterState,
  type PrinterTrigger,
  DISMISSABLE_ATTENTION,
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

export interface Attention {
  reason: AttentionReason;
  job: number | null;
}

export interface Printer {
  s: PrinterState;
  job: number | null;
  attention: Attention[];
  lost: boolean;
  /** Whether the panel currently has a live path to this printer. */
  connected: boolean;
  lastBoot: number;
  last: View;
  /** An ended system job the printer is running again (a late start). */
  lateRun: number | null;
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
}

/**
 * Proposed changes to the rules, each closing one of the gaps the exploration
 * finds in the rules as written. All off = the rules as written.
 */
export interface Amendments {
  /** On reconnect, don't conclude "the start never arrived" while the start command is undelivered, or was delivered in this same connection and not answered yet (the snapshot may predate it). */
  noTraceWaitsForStartDelivery: boolean;
  /** The start names the last print run the panel knew of; the daemon refuses to send it if the printer has run anything since (or was unreachable meanwhile). */
  daemonRejectsStartIfPrinterWasUsed: boolean;
  /** A reconcile mismatch goes away when the job ends or the printer reports it running; staff can't judge a job the printer reports running. */
  factsClearMismatch: boolean;
  /** Staff judging a mismatch get a third option: "never started, back to the queue" (printer then needs clearing; the daemon is told to never start it). */
  staffCanJudgeNotStarted: boolean;
  /** A stop for a staged job when the daemon has watched the printer ever since and it began nothing: the daemon deletes the staged file, promises never to start it and reports "cancelled before start" itself. */
  daemonConfirmsStopOfUnstartedJob: boolean;
  /** A before-start end reported by the printer itself always counts as "the printer had begun preparing". */
  printerReportedEndImpliesPrepared: boolean;
  /** Whatever frees a printer (plate cleared, part stored, maintenance ended, job returned to the queue) while the panel can't reach it leaves it offline, not idle. */
  freedWhileLostGoesOffline: boolean;
  /** The printer reports an external job while ours was sent but never reported preparing: ours ends as "start never arrived". */
  externalJobBeforePreparingEndsJob: boolean;
  /**
   * The reconnect table also covers: panel shows an external job but the printer has stopped (→ needs clearing);
   * and a current job while the printer runs something else (never reported preparing → "start never arrived",
   * otherwise staff judge). Whenever a job ends while the printer reports another job running, the printer
   * shows that external job instead of idle or needs-clearing.
   */
  reconcileCoversExternalJobs: boolean;
  /** On reconnect, a printer stopped at "failed" for a job the panel never saw printing isn't concluded automatically (it may have failed before starting): staff judge. */
  failedStateBeforeSeenPrintingNeedsStaff: boolean;
  /** After reconciling against a reconnect snapshot, older printer events resent from the daemon's outbox are dropped. */
  dropPrinterEventsOlderThanSnapshot: boolean;
}

export const AS_WRITTEN: Amendments = {
  noTraceWaitsForStartDelivery: false,
  daemonRejectsStartIfPrinterWasUsed: false,
  factsClearMismatch: false,
  staffCanJudgeNotStarted: false,
  daemonConfirmsStopOfUnstartedJob: false,
  printerReportedEndImpliesPrepared: false,
  freedWhileLostGoesOffline: false,
  externalJobBeforePreparingEndsJob: false,
  reconcileCoversExternalJobs: false,
  failedStateBeforeSeenPrintingNeedsStaff: false,
  dropPrinterEventsOlderThanSnapshot: false,
};

export const ALL_AMENDMENTS: Amendments = {
  noTraceWaitsForStartDelivery: true,
  daemonRejectsStartIfPrinterWasUsed: true,
  factsClearMismatch: true,
  staffCanJudgeNotStarted: true,
  daemonConfirmsStopOfUnstartedJob: true,
  printerReportedEndImpliesPrepared: true,
  freedWhileLostGoesOffline: true,
  externalJobBeforePreparingEndsJob: true,
  reconcileCoversExternalJobs: true,
  failedStateBeforeSeenPrintingNeedsStaff: true,
  dropPrinterEventsOlderThanSnapshot: true,
};

export interface State {
  amend: Amendments;
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

export type ActionClass = "human" | "benign" | "adverse";

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
  amend?: Amendments;
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
    amend: { ...(cfg.amend ?? AS_WRITTEN) },
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
  st.printers = devices.map((_, p) => ({ s: "IDLE", job: null, attention: [], lost: false, connected: true, lastBoot: 0, last: view(st, p), lateRun: null }));
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

function raise(pr: Printer, reason: AttentionReason, job: number | null) {
  if (!pr.attention.some((a) => a.reason === reason && a.job === job)) pr.attention.push({ reason, job });
  pr.attention.sort((a, b) => (a.reason + a.job).localeCompare(b.reason + b.job));
}
function clear(pr: Printer, pred: (a: Attention) => boolean) {
  pr.attention = pr.attention.filter((a) => !pred(a));
}

// ---------------------------------------------------------------- panel: job end

/** Ends a job and applies its effect on order and printer in one go. */
function endJob(c: Ctx, j: number, outcome: JobOutcome, why: string) {
  const st = c.st;
  const job = st.jobs[j]!;
  const pr = st.printers[job.printer]!;
  const ord = st.orders[job.order]!;
  // Check the conclusion against what the printer really did.
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
  const latest = pr.last;
  const effect = jobEndEffect({
    outcome,
    printerReportedPreparing: job.prepared,
    printerLatest: running(latest.s) && latest.job !== j ? "RUNNING_OTHER_JOB" : "IDLE",
  });
  c.setOrder(job.order, effect.order);
  // Amended: the printer completed some run the panel never tracked since dispatch, so the plate isn't known clear.
  const untrackedRun = st.amend.reconcileCoversExternalJobs && effect.printer === "endedBeforePreparing" && latest.runs > job.seenRuns;
  c.setPrinter(job.printer, untrackedRun ? "endedAfterPreparing" : effect.printer);
  clear(pr, (a) => a.job === j && (a.reason === "PRINTER_ERROR" || a.reason === "FILAMENT_RUNOUT"));
  if (effect.raiseStartFailed) raise(pr, "START_FAILED", j);
  if (st.amend.factsClearMismatch) clear(pr, (a) => a.job === j && a.reason === "RECONCILE_MISMATCH");
  if (st.amend.reconcileCoversExternalJobs && pr.s === "CLEARING_REQUIRED" && running(latest.s) && latest.job !== j) {
    c.setPrinter(job.printer, "externalJobStarted");
    raise(pr, "STARTED_WITHOUT_CLEARING", null);
  }
  ord.job = null;
  ord.lastPrinter = job.printer;
  pr.job = null;
}

function lateStart(c: Ctx, p: number, j: number, fromOldEvent = false) {
  const pr = c.st.printers[p]!;
  if (pr.lateRun === j) return;
  if (fromOldEvent) {
    c.find("staleEventTakenForLateStart", "an old event for a job that already ended was taken for the printer starting it again");
  }
  pr.lateRun = j;
  raise(pr, "LATE_START", j);
  if (pr.job === null && (pr.s === "IDLE" || pr.s === "CLEARING_REQUIRED")) c.setPrinter(p, "externalJobStarted");
}

/** An already-ended job stopped running on the printer: same as an external job ending. */
function endedJobStoppedRunning(c: Ctx, p: number, j: number) {
  const pr = c.st.printers[p]!;
  if (pr.lateRun === j) {
    pr.lateRun = null;
    clear(pr, (a) => a.reason === "LATE_START" && a.job === j);
  }
  if (pr.s === "EXTERNAL_JOB" && !running(pr.last.s)) c.setPrinter(p, "externalJobEnded");
}

function startPrinting(c: Ctx, j: number) {
  const job = c.st.jobs[j]!;
  c.setJob(j, "printerStarted");
  job.pausedFrom = null;
  c.setOrder(job.order, "printerStarted");
  c.setPrinter(job.printer, "printerStarted");
}

function pauseJob(c: Ctx, j: number, reason: "USER" | "ERROR" | null) {
  const job = c.st.jobs[j]!;
  const pr = c.st.printers[job.printer]!;
  const from = job.phase as "PREPARING" | "PRINTING";
  c.setJob(j, "printerPaused");
  job.pausedFrom = from;
  if (from === "PRINTING") c.setPrinter(job.printer, "printerPaused");
  if (reason === "ERROR") raise(pr, "PRINTER_ERROR", j);
}

function resumeJob(c: Ctx, j: number) {
  const job = c.st.jobs[j]!;
  const pr = c.st.printers[job.printer]!;
  if (job.pausedFrom === "PRINTING") {
    c.setJob(j, "printerResumedPrinting");
    c.setPrinter(job.printer, "printerResumed");
  } else {
    c.setJob(j, "printerResumedPreparing");
  }
  job.pausedFrom = null;
  clear(pr, (a) => a.job === j && a.reason === "PRINTER_ERROR");
}

function endFromEvent(c: Ctx, j: number, kind: "finished" | "failed" | "cancelled", beforeStart: boolean, why: string) {
  const outcome: JobOutcome =
    kind === "finished" ? "FINISHED" : kind === "failed" ? (beforeStart ? "START_FAILED" : "FAILED") : beforeStart ? "STOPPED_BEFORE_START" : "FAILED";
  endJob(c, j, outcome, why);
}

// ---------------------------------------------------------------- panel: messages

function handle(c: Ctx, m: Msg) {
  const st = c.st;
  const pr = st.printers[m.p]!;
  const printerEvent = !["startAccepted", "staged", "startRejectedBusy", "startFailed", "startExpired", "snapshot", "connectionUp", "connectionDown"].includes(m.kind) && m.fromPrinter !== false;
  const connectionEvent = m.kind === "connectionUp" || m.kind === "connectionDown";
  if (st.amend.dropPrinterEventsOlderThanSnapshot && m.olderThanSnapshot && (printerEvent || connectionEvent)) return;
  const knownRuns = pr.last.runs;
  if (!m.olderThanSnapshot || m.kind === "snapshot") pr.last = m.view;
  const j = m.job;
  const job = current(st, j);
  if (st.amend.factsClearMismatch && typeof m.view.job === "number" && running(m.view.s) && !m.olderThanSnapshot) {
    const vj = m.view.job;
    if (current(st, vj) && m.kind !== "connectionUp" && !(m.kind === "snapshot" && (pr.lost || pr.s === "OFFLINE" || !pr.connected))) {
      clear(pr, (a) => a.job === vj && a.reason === "RECONCILE_MISMATCH");
    }
  }
  if (st.amend.printerReportedEndImpliesPrepared && job && m.fromPrinter && (m.kind === "failed" || m.kind === "cancelled")) job.prepared = true;
  const isEnded = j !== undefined && st.jobs[j]?.phase === "ENDED";

  switch (m.kind) {
    case "connectionDown":
      pr.connected = false;
      if (pr.s === "IDLE") c.setPrinter(m.p, "disconnectedWhileIdle");
      else if (pr.s !== "OFFLINE") pr.lost = true;
      return;
    case "connectionUp":
      reconcile(c, m.p, m.view, knownRuns);
      return;
    case "snapshot":
      if (pr.lost || pr.s === "OFFLINE" || !pr.connected) {
        reconcile(c, m.p, m.view, knownRuns);
        return;
      }
      if (typeof m.view.job === "number" && m.view.s === "PREPARING") {
        const vj = m.view.job;
        const vjob = current(st, vj);
        if (vjob && (vjob.phase === "TRANSFERRING" || vjob.phase === "PREPARING")) {
          vjob.prepared = true;
          c.setJob(vj, "printerReportedPreparing");
        } else if (st.jobs[vj]?.phase === "ENDED") lateStart(c, m.p, vj);
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
      if (job && job.phase !== "PRINTING" && !(job.phase === "PAUSED" && job.pausedFrom === "PRINTING")) startPrinting(c, j!);
      else if (isEnded) lateStart(c, m.p, j!, !!m.olderThanSnapshot);
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
      if (job) {
        if (m.kind === "finished" && job.phase !== "PRINTING" && job.phase !== "PAUSED") {
          c.find("eventNotCoveredByRules", `online "finished" for a job still ${job.phase} (only allowed on reconnect)`);
        }
        endFromEvent(c, j!, m.kind, !!m.beforeStart, `event ${m.kind}`);
      } else if (isEnded) endedJobStoppedRunning(c, m.p, j!);
      return;
    case "startRejectedBusy":
    case "startFailed":
    case "startExpired":
      if (job && job.phase === "TRANSFERRING") endJob(c, j!, "SEND_FAILED", m.kind);
      return;
    case "externalStarted":
      switch (pr.s) {
        case "IDLE":
          c.setPrinter(m.p, "externalJobStarted");
          return;
        case "CLEARING_REQUIRED":
          c.setPrinter(m.p, "externalJobStarted");
          raise(pr, "STARTED_WITHOUT_CLEARING", null);
          return;
        case "MAINTENANCE":
        case "EXTERNAL_JOB":
          return;
        case "PREPARING": {
          const cur = current(st, pr.job ?? undefined)!;
          if (st.amend.reconcileCoversExternalJobs && pr.attention.some((a) => a.reason === "RECONCILE_MISMATCH")) return; // settled when staff judge
          if (cur.phase === "TRANSFERRING") {
            endJob(c, pr.job!, "SEND_FAILED", "external job started during transfer");
            return;
          }
          if (st.amend.externalJobBeforePreparingEndsJob && cur.phase === "PREPARING" && !cur.prepared) {
            endJob(c, pr.job!, "SEND_FAILED", "external job started before ours was reported preparing");
            return;
          }
          c.find("eventNotCoveredByRules", `external job started while panel printer PREPARING and job ${cur.phase}${cur.staged ? " (start sent)" : ""}`);
          return;
        }
        default:
          if (st.amend.reconcileCoversExternalJobs && pr.attention.some((a) => a.reason === "RECONCILE_MISMATCH")) return;
          c.find("eventNotCoveredByRules", `external job started while panel printer ${pr.s}`);
          return;
      }
    case "externalEnded":
      if (pr.s === "EXTERNAL_JOB") c.setPrinter(m.p, "externalJobEnded");
      else if (st.amend.reconcileCoversExternalJobs && pr.attention.some((a) => a.reason === "RECONCILE_MISMATCH")) return;
      else if (pr.s !== "MAINTENANCE") c.find("eventNotCoveredByRules", `external job ended while panel printer ${pr.s}`);
      return;
  }
}

const trace = (v: View, j: number) => v.job === j || v.files.includes(j);

/** The reconnect reconciliation table, checked top to bottom, first match wins. */
function reconcile(c: Ctx, p: number, v: View, knownRuns = v.runs) {
  const st = c.st;
  const pr = st.printers[p]!;
  const j = pr.job;
  const job = j === null ? null : st.jobs[j]!;
  const ord = job ? st.orders[job.order]! : null;
  const active = ord && (ord.s === "DISPATCHED" || ord.s === "PRINTING");
  const dispatched = ord?.s === "DISPATCHED";
  const bootChanged = v.boot !== pr.lastBoot;
  pr.lastBoot = v.boot;
  const done = () => {
    pr.lost = false;
    pr.connected = true;
  };

  // 1. The printer rebooted while we were away: never conclude automatically.
  if (active && bootChanged) {
    raise(pr, "RECONCILE_MISMATCH", j);
    if (!st.truth.printed.includes(j!)) {
      if (!st.amend.staffCanJudgeNotStarted) c.find("staffJudgementHasNoCorrectOption", "reboot while away; job never started, but staff can only judge failed or finished");
    }
    return done();
  }
  if (job && j !== null && v.job === j && running(v.s)) {
    // 2–4. Same job still running: follow the printer.
    if ((v.s === "PREPARING" || (v.s === "PAUSED" && v.pausedFromPrep)) && (job.phase === "TRANSFERRING" || job.phase === "PREPARING")) {
      job.prepared = true;
      c.setJob(j, "printerReportedPreparing");
    }
    if ((v.s === "PRINTING" || (v.s === "PAUSED" && !v.pausedFromPrep)) && dispatched) startPrinting(c, j);
    if (v.s === "PAUSED" && job.phase !== "PAUSED") pauseJob(c, j, v.pauseReason);
    if (v.s !== "PAUSED" && job.phase === "PAUSED") resumeJob(c, j);
    if (v.s === "PREPARING" && job.phase === "PAUSED") resumeJob(c, j);
    return done();
  }
  if (job && j !== null) {
    const rec = v.endRecords.find((r) => r.job === j);
    // 5. Idle, and the daemon has the end record.
    if (!running(v.s) && rec) {
      if (st.amend.printerReportedEndImpliesPrepared && rec.fromPrinter) job.prepared = true;
      endFromEvent(c, j, rec.kind, rec.beforeStart, "reconcile: end record");
      return done();
    }
    if (st.amend.dropPrinterEventsOlderThanSnapshot && rec) {
      // Amended: the end record counts whatever the printer is doing now; then look at the rest.
      if (st.amend.printerReportedEndImpliesPrepared && rec.fromPrinter) job.prepared = true;
      endFromEvent(c, j, rec.kind, rec.beforeStart, "reconcile: end record");
      return reconcile(c, p, v);
    }
    if (st.amend.reconcileCoversExternalJobs && running(v.s) && v.job !== j) {
      // Amended: the printer is busy with something else.
      if (job.phase === "TRANSFERRING") endJob(c, j, "SEND_FAILED", "reconcile: printer runs another job, our start was never sent");
      else raise(pr, "RECONCILE_MISMATCH", j);
      return done();
    }
    // 6. Daemon still transferring: keep waiting.
    if (dispatched && v.pendingStarts.includes(j)) return done();
    if (st.amend.noTraceWaitsForStartDelivery && dispatched && !job.startAccepted && (job.startDeliveredIn === null || job.startDeliveredIn === st.daemon.epoch)) return done();
    // 7. Never prepared and no trace at all: the start never arrived.
    if (dispatched && !job.prepared && !running(v.s) && !trace(v, j)) {
      endJob(c, j, "SEND_FAILED", "reconcile: no trace");
      return done();
    }
    // 8. The printer's last job is this one and it stopped at finished or failed.
    const seenPrinting = job.phase === "PRINTING" || (job.phase === "PAUSED" && job.pausedFrom === "PRINTING");
    if (v.job === j && (v.s === "FINISHED" || (v.s === "FAILED" && (seenPrinting || !st.amend.failedStateBeforeSeenPrintingNeedsStaff)))) {
      endJob(c, j, v.s === "FINISHED" ? "FINISHED" : "FAILED", `reconcile: printer stopped at ${v.s}`);
      return done();
    }
    // 9. Idle, no end record, but a trace or it had prepared: staff judge.
    if (!running(v.s) && (trace(v, j) || job.prepared)) {
      raise(pr, "RECONCILE_MISMATCH", j);
      if (!st.truth.printed.includes(j)) {
        if (!st.amend.staffCanJudgeNotStarted) c.find("staffJudgementHasNoCorrectOption", `reconcile mismatch for a job that never started printing (printer ${v.s})`);
      }
      return done();
    }
    c.find("reconcileNoRowMatched", `panel ${pr.s}/job ${job.phase}, printer ${v.s} running ${v.job === j ? "this job" : v.job === null ? "nothing" : "another job"}`);
    return done();
  }
  // No current job.
  if (running(v.s)) {
    if (typeof v.job === "number" && st.jobs[v.job]?.phase === "ENDED") {
      if (pr.s === "OFFLINE") c.setPrinter(p, "connectedRunningUnknownJob");
      lateStart(c, p, v.job);
      return done();
    }
    if (pr.s === "OFFLINE") c.setPrinter(p, "connectedRunningUnknownJob");
    else if (pr.s === "IDLE") c.setPrinter(p, "externalJobStarted");
    else if (pr.s === "CLEARING_REQUIRED") {
      c.setPrinter(p, "externalJobStarted");
      raise(pr, "STARTED_WITHOUT_CLEARING", null);
    } else if (pr.s !== "MAINTENANCE" && pr.s !== "EXTERNAL_JOB") {
      c.find("reconcileNoRowMatched", `no job, panel ${pr.s}, printer running`);
    }
    return done();
  }
  if (pr.s === "OFFLINE") {
    // Amended: also when it ran something unseen or rebooted while away (its end state is gone, the plate may not be clear).
    const unseen = st.amend.reconcileCoversExternalJobs && (v.runs > knownRuns || bootChanged);
    if (v.s === "FINISHED" || v.s === "FAILED" || v.s === "CANCELLED" || unseen) c.setPrinter(p, "connectedStoppedAtEnd");
    else c.setPrinter(p, "connectedIdle");
    return done();
  }
  if (st.amend.reconcileCoversExternalJobs && pr.s === "IDLE" && v.runs > knownRuns) {
    // Amended: the printer ran something the panel never saw; it needs clearing.
    c.setPrinter(p, "externalJobStarted");
    c.setPrinter(p, "externalJobEnded");
    return done();
  }
  if (pr.s === "EXTERNAL_JOB") {
    if (pr.lateRun !== null) endedJobStoppedRunning(c, p, pr.lateRun);
    else if (st.amend.reconcileCoversExternalJobs) c.setPrinter(p, "externalJobEnded");
    else c.find("reconcileNoRowMatched", "panel external job, printer no longer running");
  }
  return done();
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
        if (pr.s !== "IDLE" || pr.lost || pr.attention.length > 0) return;
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
          freedWhileLost(s, p);
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
    if (job && j !== null && (pr.s === "PREPARING" || pr.s === "PRINTING" || pr.s === "PAUSED") && !pending("stop")) {
      A(`stop job on printer ${p}`, "human", (c) => {
        c.st.jobs[j]!.stopSent = true;
        c.st.daemon.inbox.push({ p, kind: "stop", job: j, expired: false });
      });
    }
    if (pr.s === "EXTERNAL_JOB" && !st.daemon.inbox.some((c) => c.p === p && c.kind === "stopExternal")) {
      A(`stop external job on printer ${p}`, "human", (c) => void c.st.daemon.inbox.push({ p, kind: "stopExternal", expired: false }));
    }
    if (job && j !== null && job.phase === "PAUSED" && !pending("resume")) {
      A(`resume printer ${p}`, "human", (c) => void c.st.daemon.inbox.push({ p, kind: "resume", job: j, expired: false }));
    }
    // "Start may not have arrived": after a stop, refresh once and decide from the printer's facts.
    // Normally the printer has long acted on (or lost) what was sent to it by then; a start that is
    // still on its way at that point is the rare slow case and is budgeted like a fault.
    if (job && j !== null && job.phase === "PREPARING" && job.staged && !job.prepared && job.stopSent && !pending("stop") && st.daemon.link && st.devices[p]!.reachable && !st.daemon.outbox.some((m) => m.p === p)) {
      // (The refresh answer travels the same ordered channel, so it is read after everything already queued.)
      const d = st.devices[p]!;
      const slow = d.lanStart !== null || d.lanStop;
      A(`refresh after stopping a start that may not have arrived on printer ${p}${slow ? " (commands still on their way)" : ""}`, "human", (c) => {
        const s = c.st;
        const v = view(s, p);
        s.printers[p]!.last = v;
        if (running(v.s)) return;
        if (!trace(v, j)) endJob(c, j, "SEND_FAILED", "refresh after stop: no trace");
        else if (!s.printers[p]!.attention.some((a) => a.reason === "RECONCILE_MISMATCH")) {
          raise(s.printers[p]!, "RECONCILE_MISMATCH", j);
          if (!s.truth.printed.includes(j)) {
            if (!s.amend.staffCanJudgeNotStarted) c.find("staffJudgementHasNoCorrectOption", "refresh after stop found the job's file on the printer; staff can only judge failed or finished");
          }
        }
      }, slow ? "slowCommands" : undefined);
    }
    if (pr.attention.some((a) => a.reason === "RECONCILE_MISMATCH")) {
      const queued = st.daemon.link && st.daemon.outbox.some((m) => m.p === p); // staff act on what the panel shows once it has caught up
      if (job && j !== null && !queued && !(st.amend.factsClearMismatch && pr.last.job === j && running(pr.last.s))) {
        const truthPrinted = st.truth.printed.includes(j);
        const truthFinished = st.truth.finished.includes(j);
        // Staff look at the camera: offer the true option if there is one, else both.
        const options: JobOutcome[] = !truthPrinted
          ? st.amend.staffCanJudgeNotStarted
            ? ["STOPPED_BEFORE_START"]
            : ["FAILED", "FINISHED"]
          : truthFinished
            ? ["FINISHED"]
            : ["FAILED"];
        // Judging while a command is still on its way to the printer is the rare slow case.
        const slowJudge = st.devices[p]!.lanStart !== null || st.devices[p]!.lanStop;
        for (const outcome of options) {
          A(`staff judge printer ${p} job ${outcome}${slowJudge ? " (commands still on their way)" : ""}`, "human", (c) => {
            clear(c.st.printers[p]!, (a) => a.reason === "RECONCILE_MISMATCH");
            // "Never started" is the cautious version: the printer still needs its plate confirmed.
            if (outcome === "STOPPED_BEFORE_START") {
              c.st.jobs[j]!.prepared = true;
              // The daemon is told as well, so that it can never start this job later.
              c.st.daemon.inbox.push({ p, kind: "stop", job: j, expired: false });
            }
            endJob(c, j, outcome, "staff judgement");
          }, slowJudge ? "slowCommands" : undefined);
        }
      }
    }
    for (const reason of DISMISSABLE_ATTENTION) {
      if (pr.attention.some((a) => a.reason === reason)) {
        A(`mark ${reason} handled on printer ${p}`, "human", (c) => clear(c.st.printers[p]!, (a) => a.reason === reason));
      }
    }
    if (pr.s === "CLEARING_REQUIRED" && !st.orders.some((o) => o.s === "PRINTED" && o.lastPrinter === p)) {
      A(`confirm plate cleared on printer ${p}`, "human", (c) => {
        const s = c.st;
        c.setPrinter(p, "plateCleared");
        freedWhileLost(s, p);
        clear(s.printers[p]!, (a) => a.reason === "START_FAILED" || a.reason === "STARTED_WITHOUT_CLEARING");
        if (!running(s.devices[p]!.s)) s.devices[p]!.plateDirty = false;
      });
    }
    if ((pr.s === "IDLE" || pr.s === "OFFLINE") && pr.job === null) A(`start maintenance on printer ${p}`, "human", (c) => c.setPrinter(p, "startMaintenance"));
    if (pr.s === "MAINTENANCE" && !running(pr.last.s)) {
      A(`end maintenance on printer ${p}`, "human", (c) => {
        c.setPrinter(p, "endMaintenance");
        freedWhileLost(c.st, p);
        if (!running(c.st.devices[p]!.s)) c.st.devices[p]!.plateDirty = false;
      });
    }
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
          if (pr.s === "IDLE") c.setPrinter(p, "disconnectedWhileIdle");
          else if (pr.s !== "OFFLINE") pr.lost = true;
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
          pr.connected = false;
          if (pr.s === "IDLE") c.setPrinter(p, "disconnectedWhileIdle");
          else if (pr.s !== "OFFLINE") pr.lost = true;
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
        if (running(d.s) || (s.amend.daemonRejectsStartIfPrinterWasUsed && (t.printerWasUsed || d.runs !== t.seenRuns))) {
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

/** Amended: a printer freed while the panel can't reach it is offline, not idle (the tables don't list this yet). */
function freedWhileLost(st: State, p: number) {
  const pr = st.printers[p]!;
  if (st.amend.freedWhileLostGoesOffline && !pr.connected && pr.s === "IDLE") {
    pr.s = "OFFLINE";
    pr.lost = false;
  }
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
      if (st.amend.daemonConfirmsStopOfUnstartedJob && d.reachable && sg && sg.watched && sg.runs === d.runs) {
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
    next.printers.forEach((_, p) => freedWhileLost(next, p));
    return { label: a.label, cls: a.cls, next, findings: c.findings };
  });
}

// ---------------------------------------------------------------- properties

/** Structural invariants that must hold in every reachable state. */
export function invariantViolations(st: State): string[] {
  const out: string[] = [];
  st.printers.forEach((pr, p) => {
    if (pr.job !== null) {
      const job = st.jobs[pr.job]!;
      if (job.phase === "ENDED") out.push(`printer ${p} still points at ended job ${pr.job}`);
      if (job.printer !== p) out.push(`printer ${p} points at job of printer ${job.printer}`);
      if (!["PREPARING", "PRINTING", "PAUSED"].includes(pr.s)) out.push(`printer ${p} has a current job but is ${pr.s}`);
      if ((pr.s === "PAUSED") !== (job.phase === "PAUSED" && job.pausedFrom === "PRINTING")) out.push(`printer ${p} ${pr.s} but job ${job.phase}`);
    } else if (["PREPARING", "PRINTING", "PAUSED"].includes(pr.s)) out.push(`printer ${p} is ${pr.s} without a job`);
    if ((pr.s === "IDLE" || pr.s === "OFFLINE") && pr.lost) out.push(`printer ${p} is ${pr.s} and lost at the same time`);
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
    if (pr.attention.some((a) => a.reason === "RECONCILE_MISMATCH")) return; // waiting for staff
    if (pr.lost) out.push(`printer ${p} still flagged lost with everything delivered`);
    const r = running(d.s);
    if ((pr.s === "IDLE" || pr.s === "CLEARING_REQUIRED") && r) out.push(`panel ${pr.s} but printer ${p} is running ${d.job}`);
    if (pr.s === "EXTERNAL_JOB" && !r) out.push(`panel external job but printer ${p} is ${d.s}`);
    if ((pr.s === "PRINTING" || pr.s === "PAUSED") && !(r && d.job === pr.job)) out.push(`panel ${pr.s} job ${pr.job} but printer ${p} ${d.s} ${d.job}`);
  });
  return out;
}

const SETTLED: readonly OrderState[] = [...TERMINAL_ORDER_STATES, "FAILED"];

/** Everything has come to rest: orders settled, printers idle with no flags. */
export function settled(st: State): boolean {
  return (
    st.orders.every((o) => SETTLED.includes(o.s)) &&
    st.printers.every((pr) => pr.s === "IDLE" && pr.job === null && !pr.lost && pr.attention.length === 0)
  );
}

export const printedOrBeyond = (o: Order) => o.s === "PRINTED" || o.s === "READY_FOR_PICKUP" || o.s === "COMPLETED";

export function describe(st: State): string {
  const o = st.orders.map((x, i) => `order${i}=${x.s}${x.job !== null ? `(job${x.job})` : ""}`).join(" ");
  const p = st.printers
    .map((x, i) => `printer${i}=${x.s}${x.job !== null ? `(job${x.job})` : ""}${x.lost ? "+lost" : ""}${x.attention.map((a) => `+${a.reason}`).join("")}`)
    .join(" ");
  const d = st.devices.map((x, i) => `device${i}=${x.s}/${x.job}${x.reachable ? "" : "/unreachable"}${x.plateDirty ? "/dirty" : ""}`).join(" ");
  return `${o} | ${p} | ${d} | link=${st.daemon.link ? "up" : "down"} outbox=${st.daemon.outbox.length} inbox=${st.daemon.inbox.length}`;
}
