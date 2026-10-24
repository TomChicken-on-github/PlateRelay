import { createStore } from "../lib/store";
import type { Fil } from "./myOrders";

export type Code =
  | { st: "ok"; id: number; file: string; n: number; model: string; fil: Fil; g: number; owner: string; role: string; slot: string; when: string }
  | { st: "used"; id: number; owner: string; by: string; at: string }
  | { st: "notready"; id: number; label: string };

export const codes = createStore<Record<string, Code>>({
  "7K3Q-92": { st: "ok", id: 1046, file: "传感器支架.gcode.3mf", n: 1, model: "X1C", fil: [["#00c0e8", "PLA"]], g: 18, owner: "Tom_Chicken", role: "Builder", slot: "暂存篮 B-07", when: "10-24 07:55" },
  "4M8D-15": { st: "ok", id: 1044, file: "云台支架.gcode.3mf", n: 2, model: "P1S", fil: [["#ff7043", "ABS"]], g: 44, owner: "林小满", role: "User", slot: "暂存篮 A-03", when: "10-24 06:40" },
  "9X2P-60": { st: "used", id: 1041, owner: "周浩然", by: "Staff 陈一帆", at: "10-24 09:41" },
  "2H5N-77": { st: "notready", id: 1048, label: "打印中，还没入库" },
});

export const redeemed = createStore([
  { id: 1039, file: "电机固定板", owner: "周浩然", at: "09:41" },
  { id: 1036, file: "线缆夹", owner: "Tom_Chicken", at: "09:12" },
]);

/* prototype only: cycles through valid, used, not-ready and unknown codes */
export const SIM_CODES = ["7K3Q-92", "9X2P-60", "2H5N-77", "4M8D-15", "ZZZZ-00"];
