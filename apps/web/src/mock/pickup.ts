import { createStore } from "../lib/store";
import type { PickupOrder } from "../lib/pickupApi";

/* Mock backend rows behind lib/pickupApi.ts. Times are ISO strings. */
export type MockOrder = {
  status: string;
  order: PickupOrder;
  redeemed?: { at: string; by: string };
};

const order = (o: Partial<PickupOrder> & Pick<PickupOrder, "orderId" | "fileName">): PickupOrder => ({
  plateIndex: 1, printerModel: "X2D", weightG: 20, filaments: [{ color: "#0088ff", type: "PLA" }],
  owner: { name: "Tom_Chicken", role: "Builder" }, slot: "", storedAt: "2026-10-24T07:55:00+08:00", thumbUrl: null, ...o,
});

export const pickupOrders = createStore<Record<number, MockOrder>>({
  1046: { status: "STORED_READY_PICKUP", order: order({ orderId: 1046, fileName: "传感器支架.gcode.3mf", printerModel: "X1C", weightG: 18, filaments: [{ color: "#00c0e8", type: "PLA" }], slot: "暂存篮 B-07" }) },
  1044: { status: "STORED_READY_PICKUP", order: order({ orderId: 1044, fileName: "云台支架.gcode.3mf", plateIndex: 2, printerModel: "P1S", weightG: 44, filaments: [{ color: "#ff7043", type: "ABS" }], owner: { name: "林小满", role: "User" }, slot: "暂存篮 A-03", storedAt: "2026-10-24T06:40:00+08:00" }) },
  1043: { status: "STORED_READY_PICKUP", order: order({ orderId: 1043, fileName: "灯罩.gcode.3mf", owner: { name: "吴桐", role: "User" }, slot: "暂存篮 A-05" }) },
  1041: { status: "COMPLETED", order: order({ orderId: 1041, fileName: "电机固定板.gcode.3mf", owner: { name: "周浩然", role: "User" }, slot: "暂存篮 A-01" }), redeemed: { at: "2026-10-24T09:41:00+08:00", by: "陈一帆" } },
  1048: { status: "PRINTING", order: order({ orderId: 1048, fileName: "机械臂轴承座.gcode.3mf" }) },
});

/* Issued codes (bare 8 chars) and the one live code per order; issuing again supersedes the old one. */
export const pickupCodes = createStore<Record<string, { orderId: number; expiresAt: string }>>({});
export const liveCode = createStore<Record<number, string>>({});

/*
 * Demo codes so the scan page can be tried without a second device. In mock mode the codes issued in
 * 我的订单 live only in that browser tab, so a phone cannot scan them from another device.
 */
const soon = new Date(Date.now() + 24 * 3600e3).toISOString();
export const DEMO_CODES = { ok: "DEM0-0K44", expired: "DEM0-EXP1", redeemed: "DEM0-D0NE", notReady: "DEM0-PR1N" };
pickupCodes.set({
  DEM00K44: { orderId: 1044, expiresAt: soon },
  DEM0EXP1: { orderId: 1043, expiresAt: "2026-10-24T08:00:00+08:00" },
  DEM0D0NE: { orderId: 1041, expiresAt: soon },
  DEM0PR1N: { orderId: 1048, expiresAt: soon },
});
liveCode.set({ 1044: "DEM00K44", 1043: "DEM0EXP1", 1041: "DEM0D0NE", 1048: "DEM0PR1N" });

export const redeemed = createStore([
  { orderId: 1041, fileName: "电机固定板.gcode.3mf", owner: { name: "周浩然" }, redeemedAt: "2026-10-24T09:41:00+08:00" },
  { orderId: 1036, fileName: "线缆夹.gcode.3mf", owner: { name: "Tom_Chicken" }, redeemedAt: "2026-10-24T09:12:00+08:00" },
]);
