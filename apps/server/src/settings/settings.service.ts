import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userIdOf } from "../common/ctx.js";
import { notFound, validationFailed, versionConflict } from "../common/problem.js";
import { DB, type Db, type Tx } from "../db/db.js";
import { settings } from "../db/schema.js";
import { checkValues, defaultsOf, isSection, type Section, SECTIONS, type SectionValues } from "./definitions.js";

export interface SectionRow {
  section: Section;
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  version: number;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/**
 * System settings, one row per section of the settings page. Everything is read once at start and
 * kept in memory, so reading a setting never needs the database (and so never waits on a
 * transaction that is open elsewhere); a save replaces the section in memory.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private cache = new Map<Section, SectionRow>();

  async onModuleInit() {
    for (const s of SECTIONS) await this.row(s);
  }

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** The section's values with defaults filled in for keys never saved. */
  async get<S extends Section>(section: S, tx?: Tx): Promise<SectionValues<S>> {
    return (await this.row(section, tx)).values as SectionValues<S>;
  }

  async row(section: Section, tx?: Tx): Promise<SectionRow> {
    const hit = !tx && this.cache.get(section);
    if (hit) return hit;
    const fresh = !tx;
    const [r] = await (tx ?? this.db).select().from(settings).where(eq(settings.section, section));
    const defaults = defaultsOf(section) as Record<string, unknown>;
    const row: SectionRow = { section, values: { ...defaults, ...((r?.values as Record<string, unknown>) ?? {}) }, defaults, version: r?.version ?? 0, updatedAt: r?.updatedAt ?? null, updatedBy: r?.updatedBy ?? null };
    if (fresh) this.cache.set(section, row);
    return row;
  }

  all(): Promise<SectionRow[]> {
    return Promise.all(SECTIONS.map((s) => this.row(s)));
  }

  /** Saves the keys given; the rest of the section stays. The caller sends the version it read. */
  async save(ctx: Ctx, section: string, version: number, values: Record<string, unknown>, outer?: Tx): Promise<SectionRow> {
    if (!isSection(section)) throw notFound("settings section");
    const issues = checkValues(section, values);
    if (issues.length) throw validationFailed(issues);
    const run = async (tx: Tx) => {
      const current = await this.row(section, tx);
      if (current.version !== version) throw versionConflict(current.version);
      const stored = Object.fromEntries(Object.entries({ ...current.values, ...values }).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(current.defaults[k])));
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        if (JSON.stringify(v) === JSON.stringify(current.values[k])) continue;
        before[k] = current.values[k];
        after[k] = v;
      }
      const row = { section, values: stored, version: version + 1, updatedBy: userIdOf(ctx), updatedAt: new Date() };
      await tx.insert(settings).values(row).onConflictDoUpdate({ target: settings.section, set: row });
      await this.audit.record(ctx, { action: "settings.update", targetType: "settings", targetId: section, before, after }, tx);
    };
    await (outer ? run(outer) : this.db.transaction(run));
    const next = await this.row(section, outer ?? (this.db as Tx));
    this.cache.set(section, next);
    return next;
  }
}
