import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Uow } from "../core/uow.js";
import { printerReasons, printers, printJobs } from "../db/schema.js";

export type PrinterState = (typeof printers.$inferSelect)["state"];
export type AttentionReason = (typeof printerReasons.$inferSelect)["reason"];
export type PrinterRow = typeof printers.$inferSelect;

/**
 * The printer's state follows from three facts. A printer is AVAILABLE only if it already was:
 * whenever it stops working or stops needing attention it lands in CLEARING_REQUIRED, and the only
 * way from there to AVAILABLE is a person confirming the bed is clear. That is what keeps a print
 * from ever starting on a bed nobody checked.
 */
export function nextPrinterState(prev: PrinterState, hasReasons: boolean, running: boolean): PrinterState {
  if (hasReasons) return "ATTENTION";
  if (running) return "WORKING";
  return prev === "AVAILABLE" ? "AVAILABLE" : "CLEARING_REQUIRED";
}

export async function lockPrinter(u: Uow, printerId: string): Promise<PrinterRow | undefined> {
  const [p] = await u.tx.select().from(printers).where(eq(printers.id, printerId)).for("update");
  return p;
}

/** Brings the stored state in line with the printer's reasons and whether it is running something. Call after changing either. */
export async function settlePrinter(u: Uow, printerId: string): Promise<PrinterState> {
  const [p] = await u.tx.select().from(printers).where(eq(printers.id, printerId));
  const [{ n }] = await u.tx.select({ n: sql<number>`count(*)::int` }).from(printerReasons).where(eq(printerReasons.printerId, printerId));
  const [job] = p.currentJobId
    ? await u.tx
        .select({ id: printJobs.id })
        .from(printJobs)
        .where(and(eq(printJobs.id, p.currentJobId), ne(printJobs.phase, "ENDED")))
    : [];
  const next = nextPrinterState(p.state, n > 0, !!job || p.externalRunning);
  if (next !== p.state) await u.tx.update(printers).set({ state: next, stateSince: new Date() }).where(eq(printers.id, printerId));
  u.printers.add(printerId);
  u.todo = true;
  return next;
}

export async function addReason(u: Uow, printerId: string, reason: AttentionReason, extra: { jobId?: string | null; note?: string | null; data?: object; by?: string | null } = {}) {
  await u.tx
    .insert(printerReasons)
    .values({ printerId, reason, jobId: extra.jobId ?? null, note: extra.note ?? null, data: extra.data ?? {}, by: extra.by ?? null })
    .onConflictDoNothing();
}

/** Removes a reason; with jobId only the one raised by that job, with null only the one not tied to a job, with undefined all of that kind. */
export async function removeReason(u: Uow, printerId: string, reason: AttentionReason, jobId?: string | null): Promise<boolean> {
  const gone = await u.tx
    .delete(printerReasons)
    .where(and(eq(printerReasons.printerId, printerId), eq(printerReasons.reason, reason), jobId === undefined ? undefined : jobId === null ? isNull(printerReasons.jobId) : eq(printerReasons.jobId, jobId)))
    .returning({ id: printerReasons.id });
  return gone.length > 0;
}

export async function reasonsOf(u: Uow, printerId: string) {
  return u.tx.select().from(printerReasons).where(eq(printerReasons.printerId, printerId)).orderBy(printerReasons.since);
}
