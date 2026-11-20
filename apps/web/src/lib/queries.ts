import { useQueries, useQuery } from "@tanstack/react-query";
import { client, type Schemas, unwrap } from "./api";

export type OrderSummary = Schemas["OrderSummary"];
export type OrderDetail = Schemas["OrderDetail"];

/* Query keys are shared with the live-update handlers in live.ts. */

export const useOverview = () => useQuery({ queryKey: ["overview"], queryFn: () => unwrap(client.GET("/overview")), refetchInterval: 30e3 });

export const useMyOrders = () => useQuery({ queryKey: ["orders", "mine"], queryFn: () => unwrap(client.GET("/orders/mine", { params: { query: { limit: 100 } } })) });

export const useOrder = (id: string | undefined) =>
  useQuery({ queryKey: ["order", id], enabled: !!id, queryFn: () => unwrap(client.GET("/orders/{orderId}", { params: { path: { orderId: id! } } })) });

/** Details of several orders at once (shared cache with `useOrder`). */
export const useOrders = (ids: string[]) =>
  useQueries({
    queries: ids.map((id) => ({ queryKey: ["order", id], queryFn: () => unwrap(client.GET("/orders/{orderId}", { params: { path: { orderId: id } } })) })),
    combine: (rs) => new Map(rs.flatMap((r, i) => (r.data ? [[ids[i], r.data] as const] : []))),
  });

/* Staff views. */

export type PrinterDetail = Schemas["PrinterDetail"];
export type TodoItem = Schemas["TodoItem"];

export const usePrinters = () => useQuery({ queryKey: ["printers"], queryFn: () => unwrap(client.GET("/printers")), refetchInterval: 30e3 });

export const usePrinter = (id: string | undefined) =>
  useQuery({ queryKey: ["printers", id], enabled: !!id, queryFn: () => unwrap(client.GET("/printers/{printerId}", { params: { path: { printerId: id! } } })), refetchInterval: 30e3 });

export const useTodo = () => useQuery({ queryKey: ["todo"], queryFn: () => unwrap(client.GET("/todo")), refetchInterval: 30e3 });

/** Every order (order management), newest first; `status` is one status or comma-separated list. */
export const useAllOrders = (q: { status?: string; q?: string; limit?: number }) =>
  useQuery({
    queryKey: ["orders", "all", q],
    queryFn: () => unwrap(client.GET("/orders", { params: { query: { limit: q.limit ?? 100, ...(q.status ? { status: q.status } : {}), ...(q.q ? { q: q.q } : {}) } } })),
  });

/** The whole queue in dispatch order. */
export const useQueue = () => useQuery({ queryKey: ["orders", "queue"], queryFn: () => unwrap(client.GET("/queue")) });
