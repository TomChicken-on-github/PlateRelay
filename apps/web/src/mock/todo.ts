import { createStore } from "../lib/store";
import type { Fil } from "./myOrders";

export type Task = {
  id: string;
  /** clear: a bed to clear with nothing to store (failed, cancelled or external job). */
  kind: "stock" | "err" | "clear";
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
  pct?: number;
  /* from the server; the mock leaves them out */
  printerId?: string;
  thumb?: string | null;
  /** HMS / vendor error code shown with the message. */
  hms?: string;
  /** Standard actions the printer allows for this error (driver draft §6), STOP included. */
  actions?: string[];
};

export const tasks = createStore<Task[]>([
  { id: "t1", kind: "stock", order: 1045, file: "云台底座.gcode.3mf", n: 1, model: "P1S", nozzle: "0.4", time: "2h 40m", g: 61, fil: [["#ff7043", "ABS"]], printer: "P1S-01", owner: "周浩然", since: "38 分钟" },
  { id: "t2", kind: "stock", order: 1043, file: "电机支架.gcode.3mf", n: 1, model: "X2D", nozzle: "0.4", time: "1h 10m", g: 35, fil: [["#6155f5", "PETG"]], printer: "X2D-02", owner: "林小满", since: "12 分钟" },
  { id: "t3", kind: "err", order: 1047, file: "舵机支架.gcode.3mf", n: 1, model: "H2D", nozzle: "0.4", time: "1h 50m", g: 36, fil: [["#ff7043", "ABS"]], printer: "H2D-02", owner: "Tom_Chicken", since: "5 分钟", err: "AMS A2 断料：耗材用尽，打印已暂停（41%）", pct: 41, hms: "0700-2000-0002-0001", actions: ["RESUME", "STOP"] },
  { id: "t5", kind: "err", order: 1049, file: "传感器外壳.gcode.3mf", n: 2, model: "X2D", nozzle: "0.4", time: "2h 05m", g: 48, fil: [["#7cb342", "PLA"]], printer: "X2D-01", owner: "林小满", since: "2 分钟", err: "检测到喷嘴可能有耗材结块，打印已暂停（23%）", pct: 23, hms: "0C00-0300-0002-0010", actions: ["RESUME_PROBLEM_SOLVED", "RESUME_ACCEPT_DEFECTS", "STOP"] },
]);

/* Staging basket: zone A/B, rows 1-3, cells 1-4 */
export const ZONES = ["A", "B"], ROWS = ["1", "2", "3"], CELLS = ["1", "2", "3", "4"];
/** Panel labels for the standard error actions the server accepts (driver draft §6). */
export const ERROR_ACTION_LABEL: Record<string, string> = {
  RESUME: "继续打印",
  RESUME_PROBLEM_SOLVED: "继续打印（问题已解决）",
  RESUME_ACCEPT_DEFECTS: "继续打印（接受瑕疵）",
  RETRY: "重试",
  CONFIRM_DONE: "确认已完成，继续",
  IGNORE: "忽略并继续",
  ACKNOWLEDGE: "确认",
  STOP: "停止打印",
};
export const STOP_WHY = ["耗材问题", "喷头 / 挤出问题", "打印板问题", "模型 / 切片问题", "其他"];
