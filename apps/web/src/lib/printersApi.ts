import type { PrinterView } from "@platerelay/shared";
import { FLEET_STATUS, type FleetPrinter, type FleetStatus, fleet } from "../mock/fleet";
import { detailFor, type Printer, type PrinterDetail, PRINTERS, starStore } from "../mock/printers";
import { LIVE, type Res, api } from "./api";
import { resource } from "./live";
import { fmtAt, live as orders, shortModel } from "./ordersApi";

/*
 * Printers for 概况, the device page and 打印机管理. The panel only knows what the printer's daemon
 * reports, and no daemon is connected yet, so real printers show their registration (name, IP, serial)
 * and state, and nothing from telemetry until the daemon link exists. Nothing here talks to a printer.
 */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toPrinter(v: PrinterView): Printer {
  const t = v.telemetry ?? {};
  const two = (v.nozzles?.length ?? 0) > 1;
  return {
    id: v.id,
    name: v.name,
    model: v.model ?? "型号待设备上报",
    state: v.state,
    star: v.starred,
    nozzles: (v.nozzles?.length ? v.nozzles : [{ extruder: 1, diameter: 0.4 }]).map((n) => ({ n: two ? (n.extruder === 1 ? "左" : "右") : "喷嘴", d: n.diameter, cur: null, tgt: null })),
    bed: [null, null],
    chamber: null,
    ams: [],
    ext: null,
    order: v.job ? `#${v.job.orderId}` : null,
    who: v.job?.owner.name,
    file: v.job?.fileName,
    progress: num(t.progress) ?? (v.job ? 0 : undefined),
    used: "—",
    left: "—",
    waiting: "—",
    substage: "准备中",
    lastSeen: v.lastSeenAt ? fmtAt(v.lastSeenAt) : "从未连接",
    maintNote: v.maintenanceReason ?? undefined,
    error: v.state === "ERROR_PAUSED" ? { code: v.error?.vendorCode ?? "", module: v.error?.module ?? "", msg: v.error?.message ?? (v.error ? v.error.vendorCode : "打印机报错，等待工作人员处理"), at: fmtAt(v.error?.raisedAt) } : undefined,
    serial: v.serial ?? undefined,
    ip: v.ip ?? undefined,
  };
}

/** Device page numbers from what the panel has; telemetry stays empty until the daemon reports it. */
export function detailOf(p: Printer): PrinterDetail {
  const d = detailFor(p);
  if (!LIVE) return d;
  return { ...d, serial: p.serial ?? "—", ip: p.ip ?? "—", humidity: 0, job: d.job && { ...d.job, used: "—", left: "—", eta: "—" } };
}

const fleetState = (s: PrinterView["state"]): FleetStatus =>
  s === "PRINTING" || s === "PREPARING" || s === "UNMANAGED_PRINTING" ? "printing" : s === "IDLE" ? "idle" : s === "CLEARING_REQUIRED" ? "clear" : s === "ERROR_PAUSED" ? "error" : s === "MAINTENANCE" ? "maint" : "offline";

export function toFleet(v: PrinterView): FleetPrinter {
  const st = fleetState(v.state);
  const nz = v.nozzles ?? [];
  return {
    id: v.id,
    name: v.name,
    model: v.model ? shortModel(v.model, "") : "待上报",
    ip: v.ip ?? "—",
    sn: v.serial ?? "—",
    nozzle: nz.length > 1 ? nz.map((n) => `${n.extruder === 1 ? "左" : "右"} ${n.diameter}`).join(" · ") : nz.length ? String(nz[0].diameter) : "待上报",
    st,
    job: v.job ? `#${v.job.orderId} ${v.job.fileName.replace(/\.gcode\.3mf$/i, "")}` : st === "maint" ? (v.maintenanceReason ?? "维护中") : st === "offline" ? (v.lastSeenAt ? "连接断开" : "daemon 尚未连接") : "—",
    why: v.maintenanceReason ?? undefined,
  };
}

export const printersLive = resource(() => api<PrinterView[]>("/api/printers"));

type Rows<T> = { rows: T[]; loading: boolean; error: string | null };

/* Printer views are not audited and states move on their own, so the printer pages poll. */
export function usePrinters(): Rows<Printer> {
  const stars = starStore.use();
  if (!LIVE) return { rows: PRINTERS.map((p) => ({ ...p, star: !!stars[p.id] })), loading: false, error: null };
  const s = printersLive.use(15e3);
  return { rows: (s.data ?? []).map(toPrinter), loading: s.loading && !s.data, error: s.error };
}

export function useFleet(): Rows<FleetPrinter> {
  const mock = fleet.use();
  if (!LIVE) return { rows: mock, loading: false, error: null };
  const s = printersLive.use(15e3);
  return { rows: (s.data ?? []).map(toFleet), loading: s.loading && !s.data, error: s.error };
}

export { FLEET_STATUS };

type Done = Res<null>;
const ok: Done = { ok: true, data: null };
const refreshed = async <T,>(r: Res<T>): Promise<Res<T>> => (await printersLive.refresh(), r);

export const printersApi = {
  async star(id: string, starred: boolean): Promise<Done> {
    if (!LIVE) return starStore.set((s) => ({ ...s, [id]: starred })), ok;
    return refreshed(await api<null>(`/api/printers/${id}/star`, { method: "POST", json: { starred } }));
  },

  async create(input: { name: string; ip: string; serial: string }): Promise<Done> {
    if (!LIVE) return ok;
    return refreshed(await api<null>("/api/printers", { method: "POST", json: input }));
  },

  async update(id: string, input: { name?: string; ip?: string; serial?: string }): Promise<Done> {
    if (!LIVE) return ok;
    return refreshed(await api<null>(`/api/printers/${id}`, { method: "PATCH", json: input }));
  },

  async remove(id: string): Promise<Done> {
    if (!LIVE) return fleet.set((s) => s.filter((x) => x.id !== id)), ok;
    return refreshed(await api<null>(`/api/printers/${id}`, { method: "DELETE" }));
  },

  async maintenance(id: string, on: boolean, reason?: string): Promise<Done> {
    if (!LIVE) return fleet.set((s) => s.map((x) => (x.id === id ? { ...x, st: on ? "maint" : "idle", job: on ? (reason ?? "") : "—", why: reason } : x))), ok;
    return refreshed(await api<null>(`/api/printers/${id}/maintenance`, { method: "POST", json: { on, reason } }));
  },

  /** Stops the print on the printer's current order; the order fails with the reason. */
  async stop(id: string, reason: string): Promise<Res<{ commandSent: boolean }>> {
    if (!LIVE) return { ok: true, data: { commandSent: true } };
    const r = await api<{ commandSent: boolean }>(`/api/printers/${id}/stop`, { method: "POST", json: { reason } });
    await Promise.all([printersLive.refresh(), orders.todo.refresh()]);
    return r;
  },
};
