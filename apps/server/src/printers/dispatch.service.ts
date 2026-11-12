import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { type Ctx, userIdOf } from "../common/ctx.js";
import { notFound, Problem, ruleViolation, stateConflict } from "../common/problem.js";
import { Work } from "../core/uow.js";
import { CommandsService } from "../daemons/commands.service.js";
import { DB, type Db, type Tx } from "../db/db.js";
import { files, orders, orderVersions, printerReasons, printers, printJobs } from "../db/schema.js";
import { JobEngine, type MappingEntry } from "../jobs/job-engine.js";
import { lockPrinter, type PrinterRow } from "../jobs/printer-state.js";
import { lockQueue } from "../orders/queue.js";
import type { OrderRow } from "../orders/records.js";
import type { VersionRow } from "../orders/views.js";
import { SettingsService } from "../settings/settings.service.js";
import { type Check, checkMapping, type Choice, type MappingContext, type NozzleSpec, proposeMapping, type SliceFilament } from "./mapping.js";
import { PrinterViews, type TrayView } from "./views.js";

/* Differences a dispatcher may accept, but only by saying why. */
const NEEDS_REASON = new Set(["MATERIAL", "SUB_TYPE", "COLOUR"]);

interface Fit {
  blockers: { code: string; rule: string }[];
  context: MappingContext;
  trays: TrayView[];
  proposal: Choice[];
}

/**
 * Giving a queued order to a printer. The system suggests (longest-available printer first, first
 * order in the queue it can print), a person decides and may pick any queued order; whatever they
 * pick is checked against what the printer reports at that moment, never against what was true
 * when the order was reviewed.
 */
@Injectable()
export class DispatchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly work: Work,
    private readonly views: PrinterViews,
    private readonly engine: JobEngine,
    private readonly commands: CommandsService,
    private readonly settings: SettingsService,
  ) {}

  private async queued(tx: Tx = this.db) {
    return tx
      .select({ order: orders, version: orderVersions })
      .from(orders)
      .innerJoin(orderVersions, eq(orderVersions.id, orders.activeVersionId))
      .where(eq(orders.status, "QUEUED"))
      .orderBy(asc(orders.sortKey), asc(orders.id));
  }

  /** Whether this printer can physically print this version right now, and the mapping the system would pick. */
  private async fit(p: PrinterRow, o: Pick<OrderRow, "colourPref">, v: VersionRow, tx: Tx = this.db): Promise<Fit> {
    const trays = await this.views.trays(p.id, (await this.views.live(p.id, tx))?.snapshot, tx);
    const context: MappingContext = {
      filaments: v.filaments as SliceFilament[],
      sliceNozzles: v.nozzles as NozzleSpec[],
      printerNozzles: this.views.nozzlesOf(p),
      trays: this.views.trayStates(trays),
      colourPref: o.colourPref,
      rules: await this.settings.get("mapping"),
    };
    const blockers: Fit["blockers"] = [];
    if (p.modelId !== v.modelId) blockers.push({ code: "model_mismatch", rule: "MODEL" });
    if (context.sliceNozzles.some((n) => context.printerNozzles.some((x) => x.extruder === n.extruder && Math.abs(x.diameterMm - n.diameterMm) > 1e-6))) blockers.push({ code: "nozzle_mismatch", rule: "NOZZLE" });
    const { choices, unmatched } = proposeMapping(context);
    if (unmatched.length) blockers.push({ code: "no_tray_for_filament", rule: "EMPTY" });
    return { blockers, context, trays, proposal: choices };
  }

  private async available(tx: Tx = this.db) {
    return tx
      .select()
      .from(printers)
      .where(and(eq(printers.state, "AVAILABLE"), eq(printers.openToApplicants, true), isNull(printers.disabledAt)))
      .orderBy(asc(printers.stateSince), asc(printers.id));
  }

  /** One order per available printer: the printer that has been free longest chooses first. */
  async suggestions(tx: Tx = this.db) {
    const queue = await this.queued(tx);
    const taken = new Set<string>();
    const out: { printerId: string; orderId: string }[] = [];
    for (const p of await this.available(tx)) {
      for (const { order, version } of queue) {
        if (taken.has(order.id) || (await this.fit(p, order, version, tx)).blockers.length) continue;
        taken.add(order.id);
        out.push({ printerId: p.id, orderId: order.id });
        break;
      }
    }
    return out;
  }

  /** Orders ahead in the queue that this printer could have printed instead. */
  private async bypassed(p: PrinterRow, orderId: string, tx: Tx): Promise<string[]> {
    const out: string[] = [];
    for (const { order, version } of await this.queued(tx)) {
      if (order.id === orderId) break;
      if (!(await this.fit(p, order, version, tx)).blockers.length) out.push(order.id);
    }
    return out;
  }

  async options(printerId: string, orderId?: string) {
    const [p] = await this.db.select().from(printers).where(eq(printers.id, printerId));
    if (!p) throw notFound("printer");
    const id = orderId ?? (await this.suggestions()).find((s) => s.printerId === p.id)?.orderId ?? (await this.queued())[0]?.order.id;
    const [row] = id ? await this.db.select({ order: orders, version: orderVersions }).from(orders).innerJoin(orderVersions, eq(orderVersions.id, orders.activeVersionId)).where(eq(orders.id, id)) : [];
    if (!row) throw notFound("order");
    const fit = await this.fit(p, row.order, row.version);
    const blockers = [...fit.blockers];
    if (p.state !== "AVAILABLE" || p.disabledAt) blockers.unshift({ code: "printer_not_available", rule: "STATE" });
    if (row.order.status !== "QUEUED") blockers.unshift({ code: "order_not_queued", rule: "STATE" });
    const checked = checkMapping(fit.context, fit.proposal);
    const required = row.order.bedType ?? row.version.slicedBedType;
    return {
      printerId: p.id,
      orderId: row.order.id,
      feasible: !blockers.length,
      blockers,
      /* A printer that does not report its plate leaves it to the person dispatching to look. */
      bedType: { reported: p.bedType, required, needsConfirmation: !p.bedType || (!!required && p.bedType !== required) },
      trays: fit.trays,
      proposal: checked.map((c) => ({ entry: { sliceSlot: c.entry.sliceSlot, extruder: fit.context.filaments.find((f) => f.slot === c.entry.sliceSlot)?.extruder ?? null, tray: c.entry.tray }, checks: c.checks })),
      safety: { verdict: "PASS" as const, findings: [] },
      bypasses: row.order.status === "QUEUED" ? await this.bypassed(p, row.order.id, this.db) : [],
    };
  }

  async dispatch(
    ctx: Ctx,
    printerId: string,
    b: { orderId: string; bedType?: string | null; bedTypeMismatchConfirmed?: boolean; mapping: { sliceSlot: number; extruder?: number | null; tray: { unit: number; slot: number }; mismatchReason?: string | null; reasonVisibleToApplicant?: boolean }[] },
  ) {
    const mappingRules = await this.settings.row("mapping");
    return this.work.run(async (u) => {
      await lockQueue(u);
      const p = await lockPrinter(u, printerId);
      if (!p) throw notFound("printer");
      if (p.state !== "AVAILABLE" || p.disabledAt) {
        const reasons = (await u.tx.select({ reason: printerReasons.reason }).from(printerReasons).where(eq(printerReasons.printerId, p.id))).map((r) => r.reason);
        throw new Problem(409, "state_conflict", `the printer is ${p.disabledAt ? "disabled" : p.state}`, { current: p.state, reasons, disabled: !!p.disabledAt });
      }
      const [o] = await u.tx.select().from(orders).where(eq(orders.id, b.orderId)).for("update");
      if (!o) throw notFound("order");
      if (o.status !== "QUEUED") throw stateConflict(o.status, "QUEUED");
      /* A start command does not wait for a daemon to come back. */
      this.commands.requireOnline(p.daemonId);
      const [v] = await u.tx.select().from(orderVersions).where(eq(orderVersions.id, o.activeVersionId));
      const [file] = await u.tx.select().from(files).where(eq(files.id, v.fileId));
      if (file.purgedAt) throw ruleViolation("the file is no longer kept", { rule: "file_expired" });

      const fit = await this.fit(p, o, v, u.tx);
      const hard = fit.blockers.filter((x) => x.rule !== "EMPTY");
      if (hard.length) throw ruleViolation("this printer cannot print this order", { rule: hard[0].code, blockers: hard });

      /* The mapping the person confirmed, checked again with the same rules as the suggestion. */
      const filaments = fit.context.filaments;
      const choices: Choice[] = b.mapping.map((m) => ({ sliceSlot: m.sliceSlot, tray: m.tray }));
      if (choices.length !== filaments.length || filaments.some((f) => choices.filter((c) => c.sliceSlot === f.slot).length !== 1)) throw ruleViolation("the mapping must give every filament of the plate exactly one tray", { rule: "mapping_incomplete" });
      const checked = checkMapping(fit.context, choices);
      const failing = (result: Check["result"], only?: Set<string>) => checked.flatMap((c) => c.checks.filter((k) => k.result === result && (!only || only.has(k.rule))).map((k) => ({ sliceSlot: c.entry.sliceSlot, rule: k.rule })));
      const blocked = failing("BLOCK");
      if (blocked.length) throw new Problem(422, "mapping_blocked", "the mapping breaks a rule that cannot be overridden", { entries: blocked });
      const unexplained = failing("WARN", NEEDS_REASON).filter((x) => !b.mapping.find((m) => m.sliceSlot === x.sliceSlot)?.mismatchReason?.trim());
      if (unexplained.length) throw new Problem(422, "mapping_reason_required", "a tray that differs from what the applicant asked for needs a reason", { entries: unexplained });

      const required = o.bedType ?? v.slicedBedType;
      const bedType = b.bedType ?? p.bedType ?? required ?? "";
      if (required && bedType !== required && !b.bedTypeMismatchConfirmed) throw new Problem(422, "bed_type_mismatch", "the plate on the printer is not the one the order asks for", { required, chosen: bedType });

      const proposal = fit.proposal;
      const suggested = (await this.suggestions(u.tx)).some((s) => s.printerId === p.id && s.orderId === o.id);
      const bypassedIds = suggested ? [] : await this.bypassed(p, o.id, u.tx);
      if (bypassedIds.length) {
        await u.tx
          .update(orders)
          .set({ bypassedSince: new Date() })
          .where(and(inArray(orders.id, bypassedIds), isNull(orders.bypassedSince)));
        u.todo = true;
      }

      const entries: MappingEntry[] = checked.map((c) => {
        const given = b.mapping.find((m) => m.sliceSlot === c.entry.sliceSlot)!;
        const filament = filaments.find((f) => f.slot === c.entry.sliceSlot)!;
        const warned = c.checks.some((k) => k.result === "WARN" && NEEDS_REASON.has(k.rule));
        return {
          sliceSlot: c.entry.sliceSlot,
          /* The extruder is the one the slice assigned; it is never changed here. */
          extruder: filament.extruder,
          tray: c.entry.tray,
          suggested: proposal.find((x) => x.sliceSlot === c.entry.sliceSlot)?.tray ?? null,
          checks: c.checks,
          mismatchReason: warned ? given.mismatchReason!.trim() : null,
          reasonVisibleToApplicant: given.reasonVisibleToApplicant ?? true,
        };
      });

      const job = await this.engine.create(u, ctx, {
        orderId: o.id,
        versionId: v.id,
        versionN: v.n,
        printerId: p.id,
        mapping: entries,
        mappingSettingsVersion: mappingRules.version,
        bedType: bedType || null,
        suggested,
        bypassedOrderIds: bypassedIds,
        dispatchedBy: userIdOf(ctx),
      });
      const live = await this.views.live(p.id, u.tx);
      const command = await this.commands.enqueue(u, ctx, {
        daemonId: p.daemonId,
        printerId: p.id,
        jobId: job.id,
        kind: "job.start",
        params: {
          jobRef: job.id,
          /* The daemon refuses to start if the printer has run anything since this number. */
          expectedRunSeq: live?.runSeq ?? 0,
          file: { fileId: file.id, sha256: file.sha256, sizeBytes: file.sizeBytes },
          plateIndex: v.plateIndex,
          bedType,
          mapping: entries.map((m) => ({ sliceSlot: m.sliceSlot, extruder: m.extruder ?? fit.trays.find((t) => t.unit === m.tray.unit && t.slot === m.tray.slot)?.extruders[0] ?? 1, unit: m.tray.unit, slot: m.tray.slot })),
          timelapse: false,
        },
      });
      await u.tx.update(printJobs).set({ startCommandId: command.id }).where(eq(printJobs.id, job.id));
      return { commandId: command.id, printerId: p.id };
    });
  }
}
