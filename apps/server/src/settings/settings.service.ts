import { Inject, Injectable } from "@nestjs/common";
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
    return { ...DEFAULTS[key], ...(row?.value as object | undefined) } as SettingValue<K>;
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
