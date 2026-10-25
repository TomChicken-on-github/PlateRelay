import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { AuditService } from "../audit/audit.service.js";
import { type Ctx, userId } from "../auth/actor.js";
import { ApiError } from "../common/errors.js";
import { DB, type Db } from "../db/db.js";
import { type AnswerSnapshot, type FormField, formVersions } from "../db/schema.js";

export type FormVersion = typeof formVersions.$inferSelect;

/** Seeded by the first migration as version 1. */
export const DEFAULT_FIELDS: FormField[] = [{ id: "reason", label: "打印原因", type: "textarea", required: true }];

export const FieldsSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
        label: z.string().trim().min(1).max(40),
        type: z.enum(["text", "textarea", "single", "multi", "number"]),
        required: z.boolean(),
        options: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
      })
      .refine((f) => (f.type === "single" || f.type === "multi" ? (f.options?.length ?? 0) > 0 : !f.options), "单选、多选要有选项，其他类型不要选项"),
  )
  .max(30)
  .refine((fs) => new Set(fs.map((f) => f.id)).size === fs.length, "字段 id 不能重复");

const MAX_TEXT = { text: 200, textarea: 2000 } as const;

/** The configurable request form (brief §0.9 #3). Validation is here, not only in the browser. */
@Injectable()
export class FormsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async current(db: Db = this.db): Promise<FormVersion> {
    const [v] = await db.select().from(formVersions).orderBy(desc(formVersions.id)).limit(1);
    return v;
  }

  async update(ctx: Ctx, fields: FormField[]): Promise<FormVersion> {
    return this.db.transaction(async (tx) => {
      const before = await this.current(tx);
      const [v] = await tx.insert(formVersions).values({ fields, createdBy: userId(ctx) }).returning();
      await this.audit.record(ctx, { action: "form.update", targetType: "form", targetId: v.id, before: before?.fields, after: fields }, tx);
      return v;
    });
  }

  /** Checks answers against a form version and returns the snapshot stored on the order. */
  answer(form: FormVersion, raw: unknown): AnswerSnapshot[] {
    const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const issues: { path: string; message: string }[] = [];
    const out: AnswerSnapshot[] = [];
    for (const f of form.fields) {
      let v = input[f.id];
      if (typeof v === "string") v = v.trim();
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) {
        if (f.required) issues.push({ path: f.id, message: `${f.label}为必填` });
        out.push({ fieldId: f.id, label: f.label, type: f.type, value: null });
        continue;
      }
      const bad = (message: string) => issues.push({ path: f.id, message: `${f.label}${message}` });
      switch (f.type) {
        case "text":
        case "textarea":
          if (typeof v !== "string") bad("要是文字");
          else if (v.length > MAX_TEXT[f.type]) bad(`不能超过 ${MAX_TEXT[f.type]} 字`);
          break;
        case "number":
          if (typeof v === "string") v = Number(v);
          if (typeof v !== "number" || !Number.isFinite(v)) bad("要是数字");
          break;
        case "single":
          if (typeof v !== "string" || !f.options?.includes(v)) bad("的选项无效");
          break;
        case "multi":
          if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !f.options?.includes(x)) || new Set(v).size !== v.length) bad("的选项无效");
          break;
      }
      out.push({ fieldId: f.id, label: f.label, type: f.type, value: v as AnswerSnapshot["value"] });
    }
    if (issues.length) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid-answers", "申请表填写有误", { issues });
    return out;
  }
}
