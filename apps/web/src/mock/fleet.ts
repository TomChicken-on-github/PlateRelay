import { createStore } from "../lib/store";

export type FleetStatus = "printing" | "idle" | "clear" | "error" | "maint" | "offline";
export type FleetPrinter = { id: string; /** display name when it differs from id (server rows use UUID ids) */ name?: string; model: string; ip: string; sn: string; nozzle: string; st: FleetStatus; job: string; why?: string };

export const FLEET_STATUS: Record<FleetStatus, [string, "neutral" | "ok" | "err" | "warn"]> = {
  printing: ["打印中", "ok"], idle: ["空闲", "ok"], clear: ["待清台", "neutral"], error: ["需要处理", "err"], maint: ["维护中", "warn"], offline: ["离线", "neutral"],
};

/* Nozzle and model are reported by the printer, never typed in. */
export const fleet = createStore<FleetPrinter[]>([
  { id: "X2D-01", model: "X2D", ip: "192.168.0.103", sn: "31B8BP••••••", nozzle: "0.4", st: "printing", job: "#1049 电机固定板" },
  { id: "X2D-02", model: "X2D", ip: "192.168.0.104", sn: "31B8BP••••••", nozzle: "0.4", st: "idle", job: "—" },
  { id: "H2D-01", model: "H2D", ip: "192.168.0.111", sn: "0948AA••••••", nozzle: "左 0.4 · 右 0.4", st: "printing", job: "#1048 线缆夹" },
  { id: "H2D-02", model: "H2D", ip: "192.168.0.112", sn: "0948AA••••••", nozzle: "左 0.6 · 右 0.4", st: "error", job: "#1047 舵机支架 · AMS A2 断料" },
  { id: "P1S-01", model: "P1S", ip: "192.168.0.121", sn: "01P00A••••••", nozzle: "0.4", st: "clear", job: "#1045 等待铲件入库" },
  { id: "X1C-01", model: "X1C", ip: "192.168.0.131", sn: "00M00A••••••", nozzle: "0.4", st: "maint", job: "换喷嘴", why: "换喷嘴" },
  { id: "A1-01", model: "A1", ip: "192.168.0.141", sn: "03900A••••••", nozzle: "0.4", st: "offline", job: "连接断开" },
]);

/* LAN discovery results (SSDP), prototype only */
export const FOUND = [
  { name: "X2D-03", model: "X2D", ip: "192.168.0.106", sn: "20P6BJ3A0C00417" },
  { name: "P1S-02", model: "P1S", ip: "192.168.0.122", sn: "01P00A3B1500228" },
  { name: "X2D-01", model: "X2D", ip: "192.168.0.103", sn: "20P6BJ3A0C00311", added: true },
];

export const OFFLINE_WHY = ["换喷嘴", "换料 / 校准", "日常保养", "故障维修", "其他"];
