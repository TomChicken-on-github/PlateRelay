import { HttpStatus } from "@nestjs/common";
import type { PrinterState } from "@platerelay/shared";
import { eq } from "drizzle-orm";
import { ApiError, notFound } from "../common/errors.js";
import type { Db } from "../db/db.js";
import { printers } from "../db/schema.js";

export type PrinterRow = typeof printers.$inferSelect;
type PrinterSet = Partial<Omit<typeof printers.$inferInsert, "id" | "state" | "stateSince">>;

/** Panel-side printer transitions (brief §6.2). */
export const PRINTER_TRANSITIONS = {
  dispatch: { from: ["IDLE"], to: "PREPARING" },
  started: { from: ["PREPARING"], to: "PRINTING" },
  /** File transfer or preheat failed before anything was printed: the bed is still clean. */
  prepareFailed: { from: ["PREPARING"], to: "IDLE" },
  /** The job was taken back before it started (the owner revised the file): the bed is still clean. */
  recalled: { from: ["PREPARING"], to: "IDLE" },
  errorPaused: { from: ["PREPARING", "PRINTING"], to: "ERROR_PAUSED" },
  resumed: { from: ["ERROR_PAUSED"], to: "PRINTING" },
  finished: { from: ["PRINTING"], to: "CLEARING_REQUIRED" },
  stopped: { from: ["PREPARING", "PRINTING", "ERROR_PAUSED"], to: "CLEARING_REQUIRED" },
  externalJob: { from: ["IDLE"], to: "UNMANAGED_PRINTING" },
  externalDone: { from: ["UNMANAGED_PRINTING"], to: "CLEARING_REQUIRED" },
  cleared: { from: ["CLEARING_REQUIRED"], to: "IDLE" },
  maintenanceOn: { from: ["IDLE", "OFFLINE"], to: "MAINTENANCE" },
  maintenanceOff: { from: ["MAINTENANCE"], to: "IDLE" },
} as const satisfies Record<string, { from: readonly PrinterState[]; to: PrinterState }>;

export type PrinterTransition = keyof typeof PRINTER_TRANSITIONS;

/** Locks the printer row; 404 when missing. */
export async function lockPrinter(tx: Db, id: string): Promise<PrinterRow> {
  const [p] = await tx.select().from(printers).where(eq(printers.id, id)).for("update");
  if (!p) throw notFound("打印机");
  return p;
}

/** Time the printer has been paused on an error, to add to the order's errorPausedMs. */
export const pausedMs = (p: PrinterRow, now = new Date()) => (p.state === "ERROR_PAUSED" ? Math.max(0, now.getTime() - p.stateSince.getTime()) : 0);

/** Applies a transition to a locked printer row; 409 printer-state-conflict when it is in another state. */
export async function movePrinter(tx: Db, p: PrinterRow, name: PrinterTransition, set: PrinterSet = {}): Promise<PrinterRow> {
  const t = PRINTER_TRANSITIONS[name];
  if (!(t.from as readonly PrinterState[]).includes(p.state)) {
    throw new ApiError(HttpStatus.CONFLICT, "printer-state-conflict", "打印机状态已变化，请刷新后再试", { printerId: p.id, state: p.state });
  }
  const [row] = await tx
    .update(printers)
    .set({ ...set, state: t.to, stateSince: new Date() })
    .where(eq(printers.id, p.id))
    .returning();
  return row;
}
