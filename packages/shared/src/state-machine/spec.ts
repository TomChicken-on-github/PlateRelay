/*
 * The order, printer and print-job state machines as plain data.
 *
 * Every state change the panel makes must match one row of these tables.
 * The executable model in test/state-machine uses them to check that the
 * behaviour it derives from the rules never needs a transition the tables
 * don't list, and the server can import the same tables to guard its own
 * writes.
 */

export const ORDER_STATES = [
  "PENDING_REVIEW",
  "REJECTED",
  "QUEUED",
  "DISPATCHED",
  "PRINTING",
  "FAILED",
  "PRINTED",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
  "DISPOSED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/** States an order never leaves. FAILED is not one: a reprint takes it back to the queue. */
export const TERMINAL_ORDER_STATES: readonly OrderState[] = ["REJECTED", "COMPLETED", "CANCELLED", "DISPOSED"];

/**
 * A printer is in one of four states, named for what people have to do about it.
 * What a job is doing (preparing, printing, paused) is the job's phase, not a printer state.
 */
export const PRINTER_STATES = [
  /** Can take an order. */
  "AVAILABLE",
  /** Running something: a job of ours or one started outside the system. */
  "WORKING",
  /** Someone has to look at it. Holds as long as at least one fault reason is present. */
  "FAULT",
  /** Stopped. Someone confirms the plate is clear before it is available again. */
  "CLEARING_REQUIRED",
] as const;
export type PrinterState = (typeof PRINTER_STATES)[number];

export const JOB_PHASES = ["TRANSFERRING", "PREPARING", "PRINTING", "PAUSED", "ENDED"] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

export const JOB_OUTCOMES = [
  "FINISHED",
  /** Failed or stopped after the printer had started printing. */
  "FAILED",
  /** Stopped before the printer started printing (also while the file was still being sent). */
  "STOPPED_BEFORE_START",
  /** The start never reached the printer: transfer failed, command expired, printer busy, or no trace on reconnect. */
  "SEND_FAILED",
  /** The printer reported a failure before it started printing. */
  "START_FAILED",
] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

/** Why a printer is in FAULT. Each is removed by its own rule; the printer leaves FAULT when none is left. */
export const FAULT_REASONS = [
  /** The panel can't reach it (daemon disconnected or printer off the network), whatever it was doing. */
  "UNREACHABLE",
  /** It paused on an error or ran out of filament. Removed when it reports printing again or the job ends. */
  "PRINTER_ERROR",
  /** A job could not be sent to it. Removed by a person. */
  "SEND_FAILED",
  /** A person took it out of service. Removed by a person. */
  "MAINTENANCE",
  /** Nothing says how its job ended. Removed when a person judges the job, or the printer reports the job running. */
  "NEEDS_JUDGEMENT",
  /** Its daemon speaks an incompatible protocol version. Removed when the daemon reconnects upgraded. */
  "DAEMON_OUTDATED",
] as const;
export type FaultReason = (typeof FAULT_REASONS)[number];

/** Fault reasons a person removes with "mark as handled" or by ending maintenance. */
export const FAULTS_REMOVED_BY_PEOPLE: readonly FaultReason[] = ["SEND_FAILED", "MAINTENANCE", "NEEDS_JUDGEMENT"];

/**
 * What a person may conclude about a job the system can't settle from facts
 * (nothing on reconnect says how it ended, or a stop that nobody could confirm).
 */
export const JUDGEMENTS = {
  failed: "FAILED",
  finished: "FINISHED",
  /** Never started printing: the order goes back to the queue and the daemon is told to never start it. */
  notStarted: "STOPPED_BEFORE_START",
} as const satisfies Record<string, JobOutcome>;
export type Judgement = keyof typeof JUDGEMENTS;

export interface TransitionRow<S extends string> {
  readonly from: readonly S[];
  readonly to: S;
}

/**
 * Order transitions by trigger. Anything not listed is illegal, whoever asks.
 * `dispatch`, `jobReturnedToQueue`, `printerStarted`, `printerFinished`,
 * `printerFailed` and `staffJudgedFinished` may only happen as an effect of a
 * print-job change (see `jobEndEffect`). A person's judgement ends the job
 * with one of `JUDGEMENTS` and so uses the same rows; there is no way to set
 * an order's state directly.
 */
export const ORDER_TRANSITIONS = {
  submit: { from: [], to: "PENDING_REVIEW" },
  approve: { from: ["PENDING_REVIEW"], to: "QUEUED" },
  rejectNewSubmission: { from: ["PENDING_REVIEW"], to: "REJECTED" },
  rejectRevision: { from: ["PENDING_REVIEW"], to: "QUEUED" },
  withdrawRevision: { from: ["PENDING_REVIEW"], to: "QUEUED" },
  reviseFile: { from: ["QUEUED"], to: "PENDING_REVIEW" },
  restoreApprovedVersion: { from: ["QUEUED"], to: "QUEUED" },
  dispatch: { from: ["QUEUED"], to: "DISPATCHED" },
  jobReturnedToQueue: { from: ["DISPATCHED"], to: "QUEUED" },
  printerStarted: { from: ["DISPATCHED"], to: "PRINTING" },
  /** Also from DISPATCHED: the printer's report of the end counts even if the panel never saw the start. */
  printerFinished: { from: ["PRINTING", "DISPATCHED"], to: "PRINTED" },
  /** Also from DISPATCHED, as above, or by a person's judgement. */
  printerFailed: { from: ["PRINTING", "DISPATCHED"], to: "FAILED" },
  staffJudgedFinished: { from: ["PRINTING", "DISPATCHED"], to: "PRINTED" },
  reprint: { from: ["FAILED"], to: "QUEUED" },
  store: { from: ["PRINTED"], to: "READY_FOR_PICKUP" },
  pickUp: { from: ["READY_FOR_PICKUP"], to: "COMPLETED" },
  cancel: { from: ["PENDING_REVIEW", "QUEUED"], to: "CANCELLED" },
  dispose: { from: ["PRINTED", "READY_FOR_PICKUP"], to: "DISPOSED" },
  archiveCancels: { from: ["PENDING_REVIEW", "QUEUED"], to: "CANCELLED" },
} as const satisfies Record<string, TransitionRow<OrderState>>;
export type OrderTrigger = keyof typeof ORDER_TRANSITIONS;

/**
 * Printer transitions by trigger. Every way out of work or fault leads to
 * CLEARING_REQUIRED; only a person makes a printer available. The one automatic
 * way back from FAULT is the printer itself reporting that it is running.
 */
export const PRINTER_TRANSITIONS = {
  dispatch: { from: ["AVAILABLE"], to: "WORKING" },
  /** The printer reports running something the panel didn't expect there (an external job, or a job it had given up on). */
  printerRunning: { from: ["AVAILABLE", "CLEARING_REQUIRED"], to: "WORKING" },
  /** The job or external job ended, however it ended, or a reconnect can't tell what became of the job. */
  workEnded: { from: ["WORKING"], to: "CLEARING_REQUIRED" },
  faultRaised: { from: ["AVAILABLE", "WORKING", "CLEARING_REQUIRED"], to: "FAULT" },
  /** Last fault reason gone while the printer reports something running. */
  printerResumed: { from: ["FAULT"], to: "WORKING" },
  /** Last fault reason gone and nothing is running. */
  faultsCleared: { from: ["FAULT"], to: "CLEARING_REQUIRED" },
  plateCleared: { from: ["CLEARING_REQUIRED"], to: "AVAILABLE" },
} as const satisfies Record<string, TransitionRow<PrinterState>>;
export type PrinterTrigger = keyof typeof PRINTER_TRANSITIONS;

export const JOB_TRANSITIONS = {
  fileStaged: { from: ["TRANSFERRING"], to: "PREPARING" },
  printerReportedPreparing: { from: ["TRANSFERRING", "PREPARING"], to: "PREPARING" },
  printerStarted: { from: ["TRANSFERRING", "PREPARING", "PAUSED"], to: "PRINTING" },
  printerPaused: { from: ["PREPARING", "PRINTING"], to: "PAUSED" },
  printerResumedPreparing: { from: ["PAUSED"], to: "PREPARING" },
  printerResumedPrinting: { from: ["PAUSED"], to: "PRINTING" },
  ended: { from: ["TRANSFERRING", "PREPARING", "PRINTING", "PAUSED"], to: "ENDED" },
} as const satisfies Record<string, TransitionRow<JobPhase>>;
export type JobTrigger = keyof typeof JOB_TRANSITIONS;

export function isAllowed<S extends string>(row: TransitionRow<S>, from: S): boolean {
  return row.from.includes(from);
}

export interface JobEndEffect {
  order: OrderTrigger;
  /** The printer gets the "could not be sent" fault reason in the same transaction. */
  raiseSendFailed: boolean;
}

/**
 * What a print job's end does to its order. Order, printer and job change in
 * one transaction. The printer side needs no table: its work has ended, so it
 * needs clearing, unless it reports another job running or still has a fault.
 */
export function jobEndEffect(outcome: JobOutcome): JobEndEffect {
  switch (outcome) {
    case "FINISHED":
      return { order: "printerFinished", raiseSendFailed: false };
    case "FAILED":
      return { order: "printerFailed", raiseSendFailed: false };
    case "SEND_FAILED":
      return { order: "jobReturnedToQueue", raiseSendFailed: true };
    case "STOPPED_BEFORE_START":
    case "START_FAILED":
      return { order: "jobReturnedToQueue", raiseSendFailed: false };
  }
}
