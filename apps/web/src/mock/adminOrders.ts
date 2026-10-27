import { createStore } from "../lib/store";
import type { Fil, OrderStatus, PartsState, Version } from "./myOrders";

export type AdminOrder = {
  id: number;
  file: string;
  plate?: string;
  owner: string;
  model: string;
  nozzle: string;
  time: string;
  g: number;
  mb: number;
  fil: Fil;
  st: OrderStatus;
  at: string;
  printer?: string;
  pct?: number;
  note?: string;
  /* from the server; the mock leaves them out */
  thumb?: string | null;
  /** Place in the queue, queued orders only. */
  pos?: number;
  attributed?: boolean;
  retried?: number;
  /** Filled in by the detail request. */
  answers?: [string, string][];
  /** 版本记录 (real builds: from the order detail). */
  vers?: Version[];
  log?: [string, string][];
  /** Owner's own order: approving it is still allowed, the server checks permissions. */
  mine?: boolean;
  /** 颜色要求 label, and the plate's colours not on offer when it is 一致. */
  colour?: string;
  missing?: Fil;
  /** A revision waiting for re-review: the version before it and where the order goes when approved. */
  rev?: { n: number; file: string; model: string; time: string; g: number; fil: Fil; pos?: number; back: number | "tail" };
  /** 跳过零件: absent when the plate cannot skip parts. */
  parts?: PartsState;
};

export const ADMIN_STATUS: Record<OrderStatus, [string, "neutral" | "ok" | "err"]> = {
  pending: ["待审核", "neutral"], revising: ["修改审核中", "neutral"], queued: ["排队中", "neutral"], printing: ["打印中", "ok"], paused: ["等待处理", "neutral"], awaiting: ["待入库", "neutral"],
  ready: ["可取件", "ok"], rejected: ["已驳回", "err"], failed: ["打印失败", "err"], done: ["已完成", "neutral"], cancelled: ["已取消", "neutral"],
};

/* Shared by 审核队列 and 订单管理 */
export const adminOrders = createStore<AdminOrder[]>([
  { id: 1056, file: "齿轮箱外壳.gcode.3mf", owner: "Tom_Chicken", model: "X2D", nozzle: "0.4", time: "1h 40m", g: 52, mb: 14.2, fil: [["#6155f5", "PETG"]], st: "pending", at: "10-24 09:12" },
  { id: 1055, file: "轴承盖.gcode.3mf", owner: "林小满", model: "P1S", nozzle: "0.4", time: "0h 48m", g: 21, mb: 6.8, fil: [["#00c0e8", "PLA"]], st: "pending", at: "10-24 09:05", colour: "一致", missing: [["#00c0e8", "PLA"]] },
  { id: 1053, file: "夹爪连杆 v2.gcode.3mf", owner: "王雨桐", model: "X2D", nozzle: "0.4", time: "1h 58m", g: 44, mb: 16.1, fil: [["#0088ff", "PLA"]], st: "revising", at: "10-24 08:30", rev: { n: 1, file: "夹爪连杆.gcode.3mf", model: "X2D", time: "1h 30m", g: 37, fil: [["#0088ff", "PLA"]], pos: 2, back: 2 } },
  { id: 1052, file: "机械臂轴承座.gcode.3mf", plate: "第 3 盘 / 共 3 盘", owner: "周浩然", model: "H2D", nozzle: "0.6", time: "3h 25m", g: 96, mb: 38.5, fil: [["#00c0e8", "PLA"]], st: "queued", at: "10-24 08:40" },
  { id: 1051, file: "机械臂轴承座.gcode.3mf", plate: "第 2 盘 / 共 3 盘", owner: "周浩然", model: "X2D", nozzle: "0.4", time: "1h 12m", g: 31, mb: 38.5, fil: [["#6155f5", "PETG"]], st: "queued", at: "10-24 08:40" },
  { id: 1050, file: "云台支架.gcode.3mf", owner: "王雨桐", model: "X2D", nozzle: "0.4", time: "2h 05m", g: 58, mb: 21.0, fil: [["#ffb300", "PLA"]], st: "queued", at: "10-24 08:22" },
  { id: 1049, file: "电机固定板.gcode.3mf", owner: "Tom_Chicken", model: "X2D", nozzle: "0.4", time: "2h 00m", g: 48, mb: 17.3, fil: [["#00c0e8", "PLA"], ["#ffb300", "PLA"]], st: "printing", printer: "X2D-01", at: "10-24 08:10", pct: 62, parts: { total: 9, skipped: 0, allowed: true } },
  { id: 1048, file: "线缆夹.gcode.3mf", owner: "林小满", model: "H2D", nozzle: "0.4", time: "0h 40m", g: 9, mb: 3.1, fil: [["#ffb300", "PLA"]], st: "printing", printer: "H2D-01", at: "10-24 07:58", pct: 30 },
  { id: 1047, file: "舵机支架.gcode.3mf", owner: "Tom_Chicken", model: "H2D", nozzle: "0.4", time: "1h 50m", g: 36, mb: 12.4, fil: [["#ff7043", "ABS"]], st: "paused", printer: "H2D-02", at: "10-24 07:20", note: "AMS A2 断料" },
  { id: 1045, file: "云台底座.gcode.3mf", owner: "周浩然", model: "P1S", nozzle: "0.4", time: "2h 40m", g: 61, mb: 24.9, fil: [["#ff7043", "ABS"]], st: "awaiting", printer: "P1S-01", at: "10-24 05:30" },
  { id: 1046, file: "传感器支架.gcode.3mf", owner: "Tom_Chicken", model: "X1C", nozzle: "0.4", time: "0h 55m", g: 18, mb: 5.6, fil: [["#00c0e8", "PLA"]], st: "ready", printer: "X1C-01", at: "10-23 22:10" },
  { id: 1040, file: "电池仓盖.gcode.3mf", owner: "王雨桐", model: "X2D", nozzle: "0.4", time: "1h 05m", g: 22, mb: 8.8, fil: [["#00c0e8", "PLA"]], st: "rejected", at: "10-23 19:20", note: "壁厚过薄，请加厚到 1.2 mm 以上" },
  { id: 1038, file: "线缆夹.gcode.3mf", owner: "林小满", model: "H2D", nozzle: "0.4", time: "0h 40m", g: 9, mb: 3.1, fil: [["#ffb300", "PLA"]], st: "failed", printer: "H2D-01", at: "10-23 15:02", note: "A2 断料，已打印 37%" },
  { id: 1030, file: "电机固定板.gcode.3mf", owner: "周浩然", model: "X1C", nozzle: "0.4", time: "1h 30m", g: 40, mb: 15.0, fil: [["#6155f5", "PETG"]], st: "done", printer: "X1C-01", at: "10-23 09:00" },
  { id: 1029, file: "测试件.gcode.3mf", owner: "Tom_Chicken", model: "X2D", nozzle: "0.4", time: "0h 20m", g: 5, mb: 1.2, fil: [["#00c0e8", "PLA"]], st: "cancelled", at: "10-22 20:00", note: "选手取消：不需要了" },
]);

export const CANCEL_WHY = ["选手要求", "文件有问题", "机器故障", "排期调整", "其他"];
export const ATTRIBUTION = ["机器故障（原优先级重新排队，不扣耗材）", "模型或切片问题（折算耗材后重打）"];

const USE: Record<number, [string, string]> = { 1056: ["比赛机构件，齿轮箱外壳", "Team 07"], 1055: ["展台展示用轴承盖", "Team 03"] };
export const answers = (o: AdminOrder): [string, string][] => o.answers ?? [
  ["打印用途", (USE[o.id] ?? ["比赛机器人结构件"])[0]],
  ["所属队伍", USE[o.id]?.[1] ?? `Team 0${(o.id % 9) + 1}`],
  ["备注", "无"],
];

export const auditFor = (o: AdminOrder): [string, string][] => o.log ?? [
  [o.at, `${o.owner} 提交订单`],
  ...(o.st !== "pending" && o.st !== "rejected" ? [[o.at, "Builder 赵乐 审核通过"] as [string, string]] : []),
  ...(o.st === "rejected" ? [[o.at, "Builder 赵乐 驳回：" + o.note] as [string, string]] : []),
  ...(o.st === "cancelled" ? [["10-22 20:30", o.note ?? ""] as [string, string]] : []),
  ...(o.note && o.st !== "cancelled" && o.st !== "rejected" ? [[o.at, o.note] as [string, string]] : []),
];
