import { type QueueRules, revisionPlacesBack, type RevisionInfo } from "@platerelay/shared";
import type { OrderRow } from "../orders/transition.js";
import { compatible } from "../printers/compat.js";
import type { PrinterRow } from "../printers/printer-state.js";

/** The new version of a revised plate, as read from the uploaded file. */
export interface NextVersion {
  printerModelId: string;
  nozzles: OrderRow["nozzles"];
  filaments: OrderRow["filaments"];
  printSeconds: number;
}

export type RevisionDecision =
  | { allowed: false; code: string; message: string }
  | {
      allowed: true;
      kind: RevisionInfo["kind"];
      /** Counts towards revisions.max. */
      counts: boolean;
      /** Counts towards modelSwitch.max. */
      isSwitch: boolean;
      deltaSeconds: number;
      placesBack: number | "tail";
      /** Re-review needed; false only for 轻微修改自动审核. */
      review: boolean;
      /** Recall a dispatched job that has not started. */
      recall: boolean;
    };

/**
 * Every queue and revision decision goes through this interface (rules doc §7), so a rule engine can
 * replace the parameter-driven policy later without touching the callers. It never writes anything.
 */
export interface QueuePolicy {
  readonly id: string;
  /** Which queued order an idle printer takes; `queued` is in queue order. */
  pick(rules: QueueRules, queued: OrderRow[], printer: PrinterRow): OrderRow | undefined;
  /** May the owner replace the file now, and what happens if they do. `dispatched`: on a printer, not started yet. */
  revise(rules: QueueRules, order: OrderRow, next: NextVersion, dispatched: boolean): RevisionDecision;
  /** Whether a passed-over order should be on 待办 now. */
  remindSkipped(rules: QueueRules, order: OrderRow, now: Date): boolean;
}

export const QUEUE_POLICY = Symbol("QUEUE_POLICY");

const dual = (nozzles: OrderRow["nozzles"]) => nozzles.some((n) => n.side !== null);

/** The rules as parameters: FIFO with skipping, revision penalties from the settings. */
export class ParamPolicy implements QueuePolicy {
  readonly id = "params";

  pick(_rules: QueueRules, queued: OrderRow[], printer: PrinterRow) {
    return queued.find((o) => compatible(o, printer));
  }

  revise(rules: QueueRules, o: OrderRow, next: NextVersion, dispatched: boolean): RevisionDecision {
    const r = rules.revisions;
    if (!r.enabled) return { allowed: false, code: "revisions-disabled", message: "本场不允许提交后修改文件" };
    if (dispatched && r.whenDispatched === "refuse") return { allowed: false, code: "already-dispatched", message: "这张单已经派给打印机，不能再改" };

    const isSwitch = next.printerModelId !== o.printerModelId;
    const toSingle = isSwitch && dual(o.nozzles) && !dual(next.nozzles);
    const kind: RevisionInfo["kind"] = toSingle ? "dual-to-single" : isSwitch ? "model-switch" : "revision";
    if (isSwitch && o.modelSwitchCount >= rules.modelSwitch.max) {
      return { allowed: false, code: "model-switch-limit", message: rules.modelSwitch.max ? `换机型最多 ${rules.modelSwitch.max} 次` : "本场不允许换机型" };
    }
    const counts = kind === "revision" || (kind === "model-switch" ? rules.modelSwitch.countsAsRevision : rules.modelSwitch.dualToSingleCounts);
    if (counts && r.max > 0 && o.revisionCount >= r.max) return { allowed: false, code: "revision-limit", message: `最多修改 ${r.max} 次` };

    const base = r.baseline === "original" ? o.originalPrintSeconds : o.printSeconds;
    const deltaSeconds = Math.round(next.printSeconds - base);
    let placesBack = revisionPlacesBack(r, deltaSeconds);
    if (dispatched && placesBack !== "tail") placesBack += r.dispatchedExtraPlaces;
    if (isSwitch) {
      if (rules.modelSwitch.position === "tail") placesBack = "tail";
      else if (placesBack !== "tail") placesBack += rules.modelSwitch.extraPlaces;
    }
    const sameFilaments = (a: NextVersion["filaments"], b: NextVersion["filaments"]) =>
      a.length === b.length && a.every((f, i) => f.type === b[i].type && f.color.toLowerCase() === b[i].color.toLowerCase());
    const minor = !isSwitch && sameFilaments(o.filaments, next.filaments) && deltaSeconds <= r.thresholdMinutes * 60;
    /* a plate that was never approved has nothing to keep: it is still waiting for its first review */
    const review = o.status === "PENDING_REVIEW" || !(r.autoApproveMinor && minor);
    return { allowed: true, kind, counts, isSwitch, deltaSeconds, placesBack, review, recall: dispatched };
  }

  remindSkipped(rules: QueueRules, o: OrderRow, now: Date) {
    return o.status === "QUEUED" && !!o.skippedSince && now.getTime() - o.skippedSince.getTime() >= rules.skipReminderMinutes * 60e3;
  }
}
