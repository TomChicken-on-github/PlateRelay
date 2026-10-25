import type { AuditListQuery, AuditLogView } from "@platerelay/shared";
import { LIVE, api, type Res } from "./api";
import { settings } from "../mock/settings";

export interface AuditApi {
  list(query: AuditListQuery): Promise<Res<AuditLogView[]>>;
}

const httpApi: AuditApi = {
  list(query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    return api<AuditLogView[]>(`/api/audit?${params}`);
  },
};

const mockApi: AuditApi = {
  async list(query) {
    const equal = ["actorId", "actorType", "action", "targetType", "targetId", "result"] as const;
    const rows = settings.get().audit.filter((row) =>
      equal.every((key) => !query[key] || (key === "actorId" ? row.actorId?.toLowerCase() === query.actorId?.toLowerCase() : row[key] === query[key])) &&
      (!query.actorName || (row.actorType === "user" && !!row.actor?.name.toLowerCase().includes(query.actorName.toLowerCase()))) &&
      (!query.from || Date.parse(row.at) >= Date.parse(query.from)) &&
      (!query.to || Date.parse(row.at) <= Date.parse(query.to)) &&
      (query.beforeId === undefined || row.id < query.beforeId),
    ).sort((a, b) => b.id - a.id).slice(0, query.limit ?? 100);
    return { ok: true, data: rows };
  },
};

export const auditApi: AuditApi = LIVE ? httpApi : mockApi;
