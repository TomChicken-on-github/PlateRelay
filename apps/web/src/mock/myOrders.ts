import { createStore } from "../lib/store";

export type OrderStatus = "pending" | "revising" | "queued" | "printing" | "paused" | "awaiting" | "ready" | "rejected" | "failed" | "done" | "cancelled";
export type Fil = [string, string][];

/** 版本记录 labels: 当前 is the approved version it prints; a revision under review is 审核中 (待审核 before the first approval). */
export type VersionSt = "当前" | "已通过" | "审核中" | "待审核" | "已撤回" | "未通过";
export type Version = { n: number; file: string; model: string; modelId?: string; nozzle: string; time: string; sec: number; g: number; fil: Fil; at: string; st: VersionSt; from?: number; thumb?: string | null; reason?: string };

export type MyOrder = {
  id: number;
  file: string;
  n: number;
  model: string;
  nozzle: string;
  time: string;
  g: number;
  fil: Fil;
  st: OrderStatus;
  at: string;
  printer?: string;
  pct?: number;
  left?: string;
  eta?: string;
  pos?: number;
  ahead?: string;
  wait?: string;
  why?: string;
  done?: string;
  slot?: string;
  when?: string;
  reason?: string;
  by?: string;
  retried?: number;
  /* from the server; the mock leaves them out */
  thumb?: string | null;
  storer?: string;
  redeemer?: string;
  canceller?: string;
  /* 提交后修改: revisions used / allowed (0 = no limit), model switches likewise; seconds the next version is compared with */
  canRevise?: boolean;
  /** Real builds: the owner may cancel now (dispatched but not started included). */
  canCancel?: boolean;
  revs?: number;
  revMax?: number;
  switches?: number;
  maxSwitches?: number;
  baseSec?: number;
  modelId?: string;
  dual?: boolean;
  /** A revision is under review and an approved version exists: 撤回修改. */
  canWithdraw?: boolean;
  /** Mock only; real builds read 版本记录 from the order detail. */
  vers?: Version[];
  /** 跳过零件: absent when the plate cannot skip parts. */
  parts?: PartsState;
};

export type PartsState = { total: number; skipped: number; allowed: boolean };

export type OrderGroup = "act" | "pick" | "todo" | "end";

/* No yellow on order cards: queued, pending and paused stay neutral; only green and red tones remain. */
export const STATUS: Record<OrderStatus, { t: string; tone: "neutral" | "ok" | "err"; g: OrderGroup }> = {
  pending: { t: "待审核", tone: "neutral", g: "act" },
  revising: { t: "修改审核中", tone: "neutral", g: "act" },
  queued: { t: "排队中", tone: "neutral", g: "act" },
  printing: { t: "打印中", tone: "ok", g: "act" },
  paused: { t: "等待处理", tone: "neutral", g: "act" },
  awaiting: { t: "待入库", tone: "neutral", g: "act" },
  ready: { t: "可取件", tone: "ok", g: "pick" },
  rejected: { t: "已驳回", tone: "err", g: "todo" },
  failed: { t: "打印失败", tone: "err", g: "todo" },
  done: { t: "已完成", tone: "neutral", g: "end" },
  cancelled: { t: "已取消", tone: "neutral", g: "end" },
};

export const myOrders = createStore<MyOrder[]>([
  { id: 1051, file: "齿轮箱外壳.gcode.3mf", n: 1, model: "X2D", nozzle: "0.4", time: "1h 40m", g: 52, fil: [["#6155f5", "PETG"]], st: "pending", at: "10-24 09:12", canRevise: true, revs: 0 },
  { id: 1048, file: "机械臂轴承座.gcode.3mf", n: 1, model: "X2D", nozzle: "0.4", time: "2h 00m", g: 48, fil: [["#00c0e8", "PLA"], ["#ffcc00", "PLA"]], st: "printing", at: "10-24 08:40", printer: "X2D-01", pct: 62, left: "1h 04m", eta: "10:58", parts: { total: 9, skipped: 0, allowed: true } },
  {
    id: 1049, file: "机械臂轴承座-v2.gcode.3mf", n: 2, model: "X2D", nozzle: "0.4", time: "1h 32m", g: 36, fil: [["#6155f5", "PETG"]], st: "revising", at: "10-24 08:40", pos: 3, canRevise: true, canWithdraw: true, revs: 1,
    vers: [
      { n: 1, file: "机械臂轴承座.gcode.3mf", model: "X2D", nozzle: "0.4", time: "1h 12m", sec: 4320, g: 31, fil: [["#6155f5", "PETG"]], at: "10-24 08:40", st: "已通过" },
      { n: 2, file: "机械臂轴承座-v2.gcode.3mf", model: "X2D", nozzle: "0.4", time: "1h 32m", sec: 5520, g: 36, fil: [["#6155f5", "PETG"]], at: "10-24 09:30", st: "审核中" },
    ],
  },
  {
    id: 1050, file: "机械臂轴承座-v2.gcode.3mf", n: 3, model: "H2D", nozzle: "0.6", time: "3h 25m", g: 96, fil: [["#0088ff", "PLA"]], st: "queued", at: "10-24 08:40", pos: 5, wait: "等待兼容的打印机：H2D 当前没有可用设备", canRevise: true, revs: 1, baseSec: 11700,
    vers: [
      { n: 1, file: "机械臂轴承座.gcode.3mf", model: "H2D", nozzle: "0.6", time: "3h 15m", sec: 11700, g: 90, fil: [["#0088ff", "PLA"]], at: "10-24 08:40", st: "已通过" },
      { n: 2, file: "机械臂轴承座-v2.gcode.3mf", model: "H2D", nozzle: "0.6", time: "3h 25m", sec: 12300, g: 96, fil: [["#0088ff", "PLA"]], at: "10-24 09:05", st: "当前" },
    ],
  },
  { id: 1047, file: "舵机支架.gcode.3mf", n: 1, model: "H2D", nozzle: "0.4", time: "1h 50m", g: 36, fil: [["#ff7043", "ABS"]], st: "paused", why: "耗材异常", at: "10-24 07:20", printer: "H2D-02", pct: 41 },
  { id: 1045, file: "云台底座.gcode.3mf", n: 1, model: "P1S", nozzle: "0.4", time: "2h 40m", g: 61, fil: [["#ff7043", "ABS"]], st: "awaiting", at: "10-24 05:30", printer: "P1S-02", done: "10-24 09:01" },
  { id: 1046, file: "传感器支架.gcode.3mf", n: 1, model: "X1C", nozzle: "0.4", time: "0h 55m", g: 18, fil: [["#00c0e8", "PLA"]], st: "ready", at: "10-23 22:10", printer: "X1C-01", slot: "暂存篮 B-07", when: "10-24 07:55" },
  { id: 1040, file: "电池仓盖.gcode.3mf", n: 1, model: "X2D", nozzle: "0.4", time: "1h 05m", g: 22, fil: [["#0088ff", "PLA"]], st: "rejected", at: "10-23 19:20", reason: "壁厚过薄，可能打不成型，请加厚到 1.2 mm 以上后重新提交。", by: "Builder 赵乐" },
  { id: 1038, file: "线缆夹.gcode.3mf", n: 1, model: "H2D", nozzle: "0.4", time: "0h 40m", g: 9, fil: [["#ffcc00", "PLA"]], st: "failed", at: "10-23 15:02", printer: "H2D-01", pct: 37, reason: "A2 断料，打印中止（已完成 37%）" },
  { id: 1030, file: "电机固定板.gcode.3mf", n: 1, model: "X1C", nozzle: "0.4", time: "1h 30m", g: 40, fil: [["#6155f5", "PETG"]], st: "done", at: "10-23 09:00", when: "10-23 16:20" },
  { id: 1029, file: "测试件.gcode.3mf", n: 1, model: "X2D", nozzle: "0.4", time: "0h 20m", g: 5, fil: [["#00c0e8", "PLA"]], st: "cancelled", at: "10-22 20:44", reason: "你取消了：文件传错了" },
]);
