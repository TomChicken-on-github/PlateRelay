import { createStore } from "../lib/store";

/* Overview cards. Standard printer states follow the driver interface draft §3. */
export type PrinterState =
  | "PRINTING"
  | "PREPARING"
  | "IDLE"
  | "CLEARING_REQUIRED"
  | "UNMANAGED_PRINTING"
  | "ERROR_PAUSED"
  | "OFFLINE"
  | "MAINTENANCE";

export type Spool = { s?: string; m: string | null; c: string; r: number | null; active?: boolean };

export type Printer = {
  id: string;
  /** Display name; server rows use a UUID id, mock rows use the name as id. */
  name?: string;
  /** Current job's submitter and file when the row comes from the server (mock rows use OWNERS). */
  who?: string;
  file?: string;
  serial?: string;
  ip?: string;
  model: string;
  state: PrinterState;
  star?: boolean;
  nozzles: { n: string; d: number; cur: number | null; tgt: number | null }[];
  bed: [number | null, number | null];
  chamber: [number, number] | null;
  ams: Spool[];
  ext: Spool | null;
  order: string | null;
  progress?: number;
  layer?: [number, number];
  used?: string;
  left?: string;
  waiting?: string;
  substage?: string;
  lastSeen?: string;
  maintNote?: string;
  error?: { code: string; module: string; msg: string; at: string };
  /** 建议下一单 for an idle printer; only Staff and up see it, and nothing is sent until they confirm. */
  sug?: { orderId: number; file: string; owner: string; n: number; time: string } | null;
};

const EMPTY = (s: string): Spool => ({ s, m: null, c: "00000000", r: null });

export const PRINTERS: Printer[] = [
  { id: "X2D-01", model: "Bambu Lab X2D", state: "PRINTING", star: true,
    nozzles: [{ n: "左", d: 0.4, cur: 220, tgt: 220 }, { n: "右", d: 0.4, cur: 238, tgt: 240 }], bed: [60, 60], chamber: [38, 40],
    ams: [{ s: "A1", m: "PLA", c: "F2F2F2FF", r: 82, active: true }, { s: "A2", m: "PETG", c: "1F6FEBFF", r: 45 }, { s: "A3", m: "PLA", c: "E5484DFF", r: -1 }, EMPTY("A4")],
    ext: { m: "TPU", c: "F5A524FF", r: -1 }, order: "PR-0142", progress: 62, layer: [133, 215], used: "1h 41m", left: "1h 04m" },
  { id: "H2D-01", model: "Bambu Lab H2D", state: "ERROR_PAUSED", star: true,
    nozzles: [{ n: "左", d: 0.4, cur: 200, tgt: 220 }, { n: "右", d: 0.6, cur: 25, tgt: 0 }], bed: [55, 55], chamber: [36, 0],
    ams: [{ s: "A1", m: "PLA", c: "2B2B2BFF", r: 60 }, { s: "A2", m: "PLA", c: "3DD68CFF", r: 0, active: true }, { s: "A3", m: "PETG", c: "FFFFFFFF", r: 30 }, { s: "A4", m: "PLA", c: "FFD60AFF", r: -1 }],
    ext: null, order: "PR-0141", progress: 37, layer: [64, 180], used: "58m", left: "1h 40m",
    error: { code: "0700-2000-0002-0001", module: "AMS", msg: "AMS A2 断料，请补料后继续", at: "11:47" } },
  { id: "X1C-01", model: "Bambu Lab X1C", state: "PRINTING",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: 215, tgt: 220 }], bed: [62, 60], chamber: [38, 0],
    ams: [{ s: "A1", m: "PLA", c: "F2F2F2FF", r: 70, active: true }, { s: "A2", m: "PETG", c: "6E56CFFF", r: 52 }, { s: "A3", m: "PLA", c: "111111FF", r: 18 }, { s: "A4", m: "PLA", c: "F76B15FF", r: 90 }],
    ext: null, order: "PR-0140", progress: 80, layer: [172, 215], used: "1h 36m", left: "24m" },
  { id: "P1S-02", model: "Bambu Lab P1S", state: "PREPARING", substage: "自动调平",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: 170, tgt: 220 }], bed: [58, 60], chamber: null,
    ams: [{ s: "A1", m: "PLA", c: "E5484DFF", r: 66, active: true }, { s: "A2", m: "PLA", c: "F2F2F2FF", r: 40 }, EMPTY("A3"), EMPTY("A4")],
    ext: null, order: "PR-0138", progress: 0, layer: [0, 160], used: "4m", left: "2h 10m" },
  { id: "P2S-04", model: "Bambu Lab P2S", state: "CLEARING_REQUIRED",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: 42, tgt: 0 }], bed: [35, 0], chamber: null,
    ams: [{ s: "A1", m: "PLA", c: "1F6FEBFF", r: 55 }, { s: "A2", m: "PLA", c: "F2F2F2FF", r: 71 }, EMPTY("A3"), EMPTY("A4")],
    ext: null, order: "PR-0139", progress: 100, layer: [140, 140], used: "1h 40m", waiting: "35m" },
  { id: "A1-01", model: "Bambu Lab A1", state: "UNMANAGED_PRINTING",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: 210, tgt: 210 }], bed: [60, 60], chamber: null,
    ams: [], ext: { m: "PLA", c: "3DD68CFF", r: -1, active: true }, order: null, progress: 12, layer: [9, 75], used: "9m", left: "?" },
  { id: "P1S-05", model: "Bambu Lab P1S", state: "IDLE",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: 28, tgt: 0 }], bed: [26, 0], chamber: null,
    ams: [{ s: "A1", m: "PLA", c: "F2F2F2FF", r: 95 }, { s: "A2", m: "PLA", c: "111111FF", r: 88 }, EMPTY("A3"), EMPTY("A4")],
    ext: null, order: null, sug: { orderId: 1052, file: "云台支架.gcode.3mf", owner: "王可", n: 1, time: "1h 20m" } },
  { id: "P2S-03", model: "Bambu Lab P2S", state: "OFFLINE", lastSeen: "2026-10-23 10:48:59",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: null, tgt: null }], bed: [null, null], chamber: null, ams: [], ext: null, order: null },
  { id: "X1C-02", model: "Bambu Lab X1C", state: "MAINTENANCE", maintNote: "更换 0.4 硬化钢喷嘴",
    nozzles: [{ n: "喷嘴", d: 0.4, cur: 30, tgt: 0 }], bed: [25, 0], chamber: [26, 0], ams: [], ext: null, order: null },
];

/* order id -> [submitter, file] */
export const OWNERS: Record<string, [string, string]> = {
  "PR-0142": ["陈一帆", "机械臂轴承座.gcode.3mf"],
  "PR-0141": ["赵乐", "齿轮箱外壳.gcode.3mf"],
  "PR-0140": ["王可", "云台底座.gcode.3mf"],
  "PR-0138": ["李想", "花盆托盘.gcode.3mf"],
  "PR-0139": ["陈一帆", "超声波传感器支架.gcode.3mf"],
};

/* Prototype: what a confirmed 派单 changed, by printer id, laid over PRINTERS. */
export const dispatched = createStore<Record<string, Partial<Printer>>>({});

export const starStore = createStore<Record<string, boolean>>(Object.fromEntries(PRINTERS.map((p) => [p.id, !!p.star])));

/* Device detail. Only X2D-01 was designed in Figma; other printers reuse its layout with their own numbers. */
export type DetailSpool = { s: string; m: string; c: string; r: number; on?: boolean };
export type PrinterDetail = {
  serial: string;
  fw: string;
  ip: string;
  mqtt: number;
  upAll: string;
  temps: { icon: "nozzle" | "bed" | "chamber"; label: string; cur: number; tgt: number; max?: number }[];
  humidity: number;
  ams: DetailSpool[];
  extL: string | null;
  extR: string | null;
  job: { who: string; file: string; pct: number; layer: [number, number]; used: string; left: string; eta: string } | null;
  log: ["ok" | "warn" | "", string, string][];
};

export const DETAIL: Record<string, PrinterDetail> = {
  "X2D-01": {
    serial: "01P09C450300016", fw: "01.08.02.05", ip: "192.168.1.101", mqtt: 12, upAll: "2,341h",
    temps: [
      { icon: "nozzle", label: "左喷嘴", cur: 215, tgt: 220, max: 300 },
      { icon: "nozzle", label: "右喷嘴", cur: 210, tgt: 215, max: 300 },
      { icon: "bed", label: "热床", cur: 62, tgt: 60, max: 110 },
      { icon: "chamber", label: "腔体", cur: 38, tgt: 40 },
    ],
    humidity: 42,
    /* values from the Figma component "AMS / Ext 耗材切换" (269:3463) */
    ams: [{ s: "A1", m: "PLA", c: "#00c0e8", r: 75, on: true }, { s: "A2", m: "PETG", c: "#6155f5", r: 65 }, { s: "A3", m: "PLA", c: "#0088ff", r: 15 }, { s: "A4", m: "PLA", c: "#ffcc00", r: 35 }],
    extL: null, extR: "#ffcc00",
    job: { who: "Tom_Chicken", file: "机械臂轴承.3mf.gcode", pct: 80, layer: [172, 215], used: "1h 36m", left: "24m", eta: "14:47" },
    log: [["ok", "12:47", "打印任务已开始"], ["warn", "12:45", "A3 槽位余量低于 20%"], ["", "12:34", "设备归零完成"]],
  },
};

const hex6 = (c: string) => "#" + c.slice(0, 6).toLowerCase();

export function detailFor(p: Printer): PrinterDetail {
  if (DETAIL[p.id]) return DETAIL[p.id];
  const o: [string, string] | null = p.order ? (p.file ? [p.who ?? "", p.file] : (OWNERS[p.order] ?? null)) : null;
  const temps: PrinterDetail["temps"] = p.nozzles.map((n) => ({ icon: "nozzle" as const, label: p.nozzles.length > 1 ? `${n.n}喷嘴` : "喷嘴", cur: n.cur ?? 0, tgt: n.tgt ?? 0, max: 300 }));
  temps.push({ icon: "bed", label: "热床", cur: p.bed[0] ?? 0, tgt: p.bed[1] ?? 0, max: 110 });
  if (p.chamber) temps.push({ icon: "chamber", label: "腔体", cur: p.chamber[0], tgt: p.chamber[1] });
  const ams = p.ams.filter((s) => s.m).map((s) => ({ s: s.s!, m: s.m!, c: hex6(s.c), r: Math.max(0, s.r ?? 0), on: s.active }));
  return {
    serial: "—", fw: "—", ip: "—", mqtt: 0, upAll: "—", temps, humidity: 38, ams,
    extL: null, extR: p.ext ? hex6(p.ext.c) : null,
    job: o && p.progress != null ? { who: o[0], file: o[1], pct: p.progress, layer: p.layer ?? [0, 0], used: p.used ?? "—", left: p.left ?? "—", eta: "—" } : null,
    log: [],
  };
}
