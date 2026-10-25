/*
 * Order states (brief §6.1). QUEUED is the brief's SLICED: since submitters
 * slice their own files it now means "approved, waiting for a printer".
 *
 * A recoverable printer error does not change the order: it stays PRINTING
 * and the API flags it as waiting for a handler (等待处理). Only a handler
 * stopping the print with a reason makes it FAILED (brief §0.9 #7).
 */
export const ORDER_STATUSES = [
  "PENDING_REVIEW",
  "REJECTED",
  "QUEUED",
  "PRINTING",
  "PRINTED_AWAITING_STORAGE",
  "STORED_READY_PICKUP",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** States an order cannot leave. FAILED is final too; a retry is a new order. */
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ["REJECTED", "COMPLETED", "FAILED", "CANCELLED"];

/** What a submitter may cancel on their own. */
export const OWNER_CANCELLABLE: readonly OrderStatus[] = ["PENDING_REVIEW", "QUEUED"];

/**
 * 失败归因. machine: not the submitter's fault, the retry goes straight back
 * to the queue at the failed order's position. model: a slicing or model
 * problem, the retry goes back to review.
 */
export const FAILURE_ATTRIBUTIONS = ["machine", "model"] as const;
export type FailureAttribution = (typeof FAILURE_ATTRIBUTIONS)[number];

/** Panel-side printer states (brief §6.2 plus OFFLINE and MAINTENANCE, driver draft §3). */
export const PRINTER_STATES = [
  "OFFLINE",
  "IDLE",
  "PREPARING",
  "PRINTING",
  "ERROR_PAUSED",
  "CLEARING_REQUIRED",
  "UNMANAGED_PRINTING",
  "MAINTENANCE",
] as const;

export type PrinterState = (typeof PRINTER_STATES)[number];
