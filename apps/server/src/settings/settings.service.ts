import { Inject, Injectable } from "@nestjs/common";
import { DEFAULT_QUEUE_RULES, DEFAULT_RESOURCE_SETTINGS, type QueueRules, type ResourceSettings } from "@platerelay/shared";
import { eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userId } from "../auth/actor.js";
import { DB, type Db } from "../db/db.js";
import { settings } from "../db/schema.js";

/** Panel settings kept as key → JSON. Each key has a default here. */
export const DEFAULTS = {
  /** Anyone can create a User account from the sign-in page. */
  "auth.registration": { enabled: true },
  /** Queue rule; FIFO is the only one so far (brief §0.6). */
  "queue.policy": { rule: "fifo" as const },
  /** 文件与排队: revisions, model switches, skip reminder, plate choice (rules doc §2–4). */
  "queue.rules": DEFAULT_QUEUE_RULES as QueueRules,
  /** 可用资源: the submit page's resource table (rules doc §1.5). */
  resources: DEFAULT_RESOURCE_SETTINGS as ResourceSettings,
} satisfies Record<string, unknown>;

export type SettingKey = keyof typeof DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof DEFAULTS)[K];

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key));
    return merge(DEFAULTS[key], row?.value) as SettingValue<K>;
  }

  async set<K extends SettingKey>(ctx: Ctx, key: K, value: SettingValue<K>) {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(settings).where(eq(settings.key, key));
      await tx
        .insert(settings)
        .values({ key, value, updatedBy: userId(ctx), updatedAt: new Date() })
        .onConflictDoUpdate({ target: settings.key, set: { value, updatedBy: userId(ctx), updatedAt: new Date() } });
      await this.audit.record(ctx, { action: "settings.update", targetType: "setting", targetId: key, before: row?.value ?? DEFAULTS[key], after: value }, tx);
    });
  }
}

/** Stored values over the defaults, one level of nesting deep, so a new rule gets its default on old rows. */
function merge(def: unknown, stored: unknown): unknown {
  if (!isObj(def) || !isObj(stored)) return stored ?? def;
  const out: Record<string, unknown> = { ...def };
  for (const [k, v] of Object.entries(stored)) out[k] = isObj(def[k]) && isObj(v) && !Array.isArray(v) ? { ...def[k], ...v } : v;
  return out;
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
