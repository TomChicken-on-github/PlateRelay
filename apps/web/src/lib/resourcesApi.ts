import type { ResourceSettings, ResourcesView } from "@platerelay/shared";
import { reported, resourceSettings } from "../mock/resources";
import { LIVE, type Res, api } from "./api";
import { resource } from "./live";

/* 本场可用资源: the table on the submit page (resource:view) and its settings (resource:configure). */

const live = {
  view: resource(() => api<ResourcesView>("/api/resources")),
  settings: resource(() => api<ResourceSettings>("/api/settings/resources")),
};

/** The mock applies the settings to what the printers "reported", the way the server does. */
function mockView(s: ResourceSettings): ResourcesView {
  const order = (o: number | undefined, i: number) => o ?? 1000 + i;
  const models = reported.models
    .map((m, i) => ({ m: { ...m, note: s.models[m.modelId]?.note ?? "", hidden: !!s.models[m.modelId]?.hidden, wait: s.models[m.modelId]?.wait ?? m.wait, waitManual: !!s.models[m.modelId]?.wait }, k: order(s.models[m.modelId]?.order, i) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);
  const types = [...new Set([...reported.materials.map((m) => m.type), ...s.stock.map((x) => x.type)])];
  const materials = types
    .map((type, i) => {
      const base = reported.materials.find((m) => m.type === type)?.colors ?? [];
      const stock = s.stock.filter((x) => x.type === type).map((x) => ({ color: x.color, name: x.name, stock: true, modelIds: x.modelIds }));
      return { m: { type, colors: [...base, ...stock], note: s.materials[type]?.note ?? "", hidden: !!s.materials[type]?.hidden }, k: order(s.materials[type]?.order, i) };
    })
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);
  return { show: s.show, bulletin: s.bulletin, colourMissing: s.colourMissing, models, materials };
}

export function useResources(): { data: ResourcesView | null; error: string | null } {
  const s = resourceSettings.use();
  const l = LIVE ? live.view.use() : null;
  return l ? { data: l.data, error: l.error } : { data: mockView(s), error: null };
}

export function useResourceSettings(): { data: ResourceSettings | null; error: string | null } {
  const s = resourceSettings.use();
  const l = LIVE ? live.settings.use() : null;
  return l ? { data: l.data, error: l.error } : { data: s, error: null };
}

export async function saveResourceSettings(next: ResourceSettings): Promise<Res<null>> {
  if (!LIVE) return resourceSettings.set(next), { ok: true, data: null };
  const r = await api<null>("/api/settings/resources", { method: "PUT", json: next });
  await Promise.all([live.settings.refresh(), live.view.refresh()]);
  return r;
}
