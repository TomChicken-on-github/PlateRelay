import type { QueueRules } from "@platerelay/shared";
import { settings } from "../mock/settings";
import { LIVE, type Res, api } from "./api";
import { resource } from "./live";

/* 文件与排队: the print rules. Everyone signed in reads them (submit page, 我的订单); settings:manage saves them. */

const live = resource(() => api<QueueRules>("/api/rules"));

export function useRules(): QueueRules | null {
  const mock = settings.use().rules;
  const l = LIVE ? live.use().data : null;
  return LIVE ? l : mock;
}

export async function saveRules(next: QueueRules): Promise<Res<null>> {
  if (!LIVE) return settings.set((s) => ({ ...s, rules: next })), { ok: true, data: null };
  const r = await api<null>("/api/settings/rules", { method: "PUT", json: next });
  await live.refresh();
  return r;
}
