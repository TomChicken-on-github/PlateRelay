import type { Tone } from "@/components/printer/status";
import type { OrderSummary } from "./queries";

export type OrderStatus = OrderSummary["status"];

/* Applicant wording for each order status, and its colour. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  PENDING_REVIEW: { label: "等待审核", tone: "idle" },
  REJECTED: { label: "已驳回", tone: "alert" },
  QUEUED: { label: "排队中", tone: "idle" },
  DISPATCHED: { label: "已派单", tone: "busy" },
  PRINTING: { label: "打印中", tone: "busy" },
  FAILED: { label: "失败", tone: "alert" },
  PRINTED: { label: "打印完成", tone: "idle" },
  READY: { label: "待取件", tone: "ok" },
  COMPLETED: { label: "已完成", tone: "idle" },
  CANCELLED: { label: "已取消", tone: "idle" },
  DISPOSED: { label: "已处理", tone: "idle" },
};

export const ENDED: OrderStatus[] = ["REJECTED", "COMPLETED", "CANCELLED", "DISPOSED"];

/** What to call an order: its plate's name, else the file name without the extension. */
export function orderName(o: Pick<OrderSummary, "plate" | "fileName">): string {
  return o.plate.name?.trim() || (o.fileName ?? "").replace(/\.gcode\.3mf$/i, "") || `第 ${o.plate.index} 盘`;
}

/** "#0039" */
export const orderNo = (n: number) => `#${String(n).padStart(4, "0")}`;
