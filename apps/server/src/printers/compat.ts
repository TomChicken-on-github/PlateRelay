import type { orders, printers } from "../db/schema.js";

type O = Pick<typeof orders.$inferSelect, "printerModelId" | "nozzles">;
type P = Pick<typeof printers.$inferSelect, "modelId" | "nozzles" | "storage" | "state">;

/** Same printer model and, for every extruder the plate uses, the same nozzle diameter. */
export function compatible(o: O, p: P): boolean {
  if (!p.modelId || p.modelId !== o.printerModelId) return false;
  return o.nozzles.every((n) => p.nozzles?.some((pn) => pn.extruder === n.extruder && Math.abs(pn.diameter - n.diameter) < 1e-6));
}

/** Can take a job now: idle and has a medium it can write the file to (P1 without an SD card cannot). */
export function hasWritableStorage(p: P): boolean {
  return !!p.storage?.some((s) => s.present && s.writable);
}

/** Why a queued order is not printing yet, shown to submitters and staff; null when it is simply waiting its turn. */
export function waitReason(o: O & { printerModel: string | null }, fleet: P[]): string | null {
  const fit = fleet.filter((p) => compatible(o, p));
  const model = (o.printerModel ?? o.printerModelId).replace(/^Bambu Lab /, "");
  if (!fit.some((p) => p.state !== "OFFLINE" && p.state !== "MAINTENANCE")) return `等待兼容的打印机：${model} 当前没有可用设备`;
  if (!fit.some(hasWritableStorage)) return "兼容的打印机都没有可用的存储卡";
  return null;
}
