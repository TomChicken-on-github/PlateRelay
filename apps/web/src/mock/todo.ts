import { createStore } from "../lib/store";
import type { Fil } from "./myOrders";

export type Task = {
  id: string;
  /** clear: a bed to clear with nothing to store (failed, cancelled or external job). */
  kind: "stock" | "err" | "clear" | "skip";
  order: number;
  file: string;
  n: number;
  model: string;
  nozzle: string;
  time: string;
  g: number;
  fil: Fil;
  printer: string;
  owner: string;
  since: string;
  err?: string;
  /** skip: why printers keep passing it over. */
  why?: string;
  pct?: number;
  /* from the server; the mock leaves them out */
  printerId?: string;
  thumb?: string | null;
  /** Standard actions the printer allows for this error, STOP aside. */
  actions?: string[];
};

export const tasks = createStore<Task[]>([
  { id: "t1", kind: "stock", order: 1045, file: "云台底座.gcode.3mf", n: 1, model: "P1S", nozzle: "0.4", time: "2h 40m", g: 61, fil: [["#ff7043", "ABS"]], printer: "P1S-01", owner: "周浩然", since: "38 分钟" },
  { id: "t2", kind: "stock", order: 1043, file: "电机支架.gcode.3mf", n: 1, model: "X2D", nozzle: "0.4", time: "1h 10m", g: 35, fil: [["#6155f5", "PETG"]], printer: "X2D-02", owner: "林小满", since: "12 分钟" },
  { id: "t3", kind: "err", order: 1047, file: "舵机支架.gcode.3mf", n: 1, model: "H2D", nozzle: "0.4", time: "1h 50m", g: 36, fil: [["#ff7043", "ABS"]], printer: "H2D-02", owner: "Tom_Chicken", since: "5 分钟", err: "AMS A2 断料：耗材用尽，打印已暂停（41%）", pct: 41 },
  { id: "t4", kind: "skip", order: 1050, file: "机械臂轴承座.gcode.3mf", n: 3, model: "H2D", nozzle: "0.6", time: "3h 25m", g: 96, fil: [["#0088ff", "PLA"]], printer: "队列第 1 位", owner: "周浩然", since: "42 分钟", why: "等待兼容的打印机：H2D 0.6 mm 当前没有可用设备" },
]);

/* Staging basket: zone A/B, rows 1-3, cells 1-4 */
export const ZONES = ["A", "B"], ROWS = ["1", "2", "3"], CELLS = ["1", "2", "3", "4"];
export const STOP_WHY = ["耗材问题", "喷头 / 挤出问题", "打印板问题", "模型 / 切片问题", "其他"];
