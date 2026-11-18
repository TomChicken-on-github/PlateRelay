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
