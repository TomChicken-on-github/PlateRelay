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

export const PRINTER_STATES = [
  "OFFLINE",
  "IDLE",
  "PREPARING",
  "PRINTING",
  "PAUSED",
  "CLEARING_REQUIRED",
  "EXTERNAL_JOB",
  "MAINTENANCE",
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

/** Reasons behind the "needs attention" flag. Each is cleared by its own rule. */
export const ATTENTION_REASONS = [
  "PRINTER_ERROR",
  "FILAMENT_RUNOUT",
  "START_FAILED",
  "RECONCILE_MISMATCH",
  "LATE_START",
  "STARTED_WITHOUT_CLEARING",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** Attention reasons that staff may dismiss with "mark as handled". */
export const DISMISSABLE_ATTENTION: readonly AttentionReason[] = ["START_FAILED", "STARTED_WITHOUT_CLEARING", "LATE_START"];

export interface TransitionRow<S extends string> {
  readonly from: readonly S[];
  readonly to: S;
}

/**
 * Order transitions by trigger. Anything not listed is illegal, whoever asks.
 * `dispatch`, `jobReturnedToQueue`, `printerStarted`, `printerFinished`,
 * `printerFailed`, `staffJudgedFinished` and `staffJudgedFailed` may only
 * happen as an effect of a print-job change (see JOB_END_EFFECTS).
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
  /** From DISPATCHED only when a reconnect finds the printer already finished. */
  printerFinished: { from: ["PRINTING", "DISPATCHED"], to: "PRINTED" },
  /** From DISPATCHED only when a reconnect finds the printer already failed, or staff judge a mismatch. */
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
 * Printer transitions by trigger. Losing the connection while not idle is not
 * a transition: the printer keeps its last state and gets the "lost" flag.
 */
export const PRINTER_TRANSITIONS = {
  connectedIdle: { from: ["OFFLINE"], to: "IDLE" },
  connectedRunningUnknownJob: { from: ["OFFLINE"], to: "EXTERNAL_JOB" },
  connectedStoppedAtEnd: { from: ["OFFLINE"], to: "CLEARING_REQUIRED" },
  disconnectedWhileIdle: { from: ["IDLE"], to: "OFFLINE" },
  dispatch: { from: ["IDLE"], to: "PREPARING" },
  printerStarted: { from: ["PREPARING"], to: "PRINTING" },
  /** Job ended before start and the printer never reported preparing (nothing can be on the plate). */
  endedBeforePreparing: { from: ["PREPARING"], to: "IDLE" },
  /** Job ended before start after the printer had reported preparing (it may have extruded). */
  endedAfterPreparing: { from: ["PREPARING"], to: "CLEARING_REQUIRED" },
  printerPaused: { from: ["PRINTING"], to: "PAUSED" },
  printerResumed: { from: ["PAUSED"], to: "PRINTING" },
  /** From PREPARING only when a reconnect finds the printer already at its end state. */
  printerEnded: { from: ["PRINTING", "PAUSED", "PREPARING"], to: "CLEARING_REQUIRED" },
  externalJobStarted: { from: ["IDLE", "CLEARING_REQUIRED"], to: "EXTERNAL_JOB" },
  externalJobTookOverDuringTransfer: { from: ["PREPARING"], to: "EXTERNAL_JOB" },
  externalJobEnded: { from: ["EXTERNAL_JOB"], to: "CLEARING_REQUIRED" },
  plateCleared: { from: ["CLEARING_REQUIRED"], to: "IDLE" },
  startMaintenance: { from: ["IDLE", "OFFLINE"], to: "MAINTENANCE" },
  endMaintenance: { from: ["MAINTENANCE"], to: "IDLE" },
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

export interface JobEndInput {
  outcome: JobOutcome;
  /** The printer itself reported preparing for this job at least once. */
  printerReportedPreparing: boolean;
  /** What the printer is doing right now according to its latest report. */
  printerLatest: "IDLE" | "RUNNING_OTHER_JOB";
}

export interface JobEndEffect {
  order: OrderTrigger;
  printer: PrinterTrigger;
  /** Raise "start failed" attention in the same transaction. */
  raiseStartFailed: boolean;
}

/**
 * What a print job's end does to its order and printer. Order, printer and
 * job change in one transaction; nothing else may write these states.
 */
export function jobEndEffect(input: JobEndInput): JobEndEffect {
  switch (input.outcome) {
    case "FINISHED":
      return { order: "printerFinished", printer: "printerEnded", raiseStartFailed: false };
    case "FAILED":
      return { order: "printerFailed", printer: "printerEnded", raiseStartFailed: false };
    case "SEND_FAILED":
    case "STOPPED_BEFORE_START":
    case "START_FAILED": {
      const raiseStartFailed = input.outcome === "START_FAILED";
      if (input.outcome !== "SEND_FAILED" && input.printerReportedPreparing) {
        return { order: "jobReturnedToQueue", printer: "endedAfterPreparing", raiseStartFailed };
      }
      return {
        order: "jobReturnedToQueue",
        printer: input.printerLatest === "RUNNING_OTHER_JOB" ? "externalJobTookOverDuringTransfer" : "endedBeforePreparing",
        raiseStartFailed,
      };
    }
  }
}
