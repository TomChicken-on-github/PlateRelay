import { HttpStatus } from "@nestjs/common";
import type { z } from "zod";
import { ApiError } from "./errors.js";

/** Validates a request body or query; 400 {code: "invalid", issues} when it does not match. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new ApiError(HttpStatus.BAD_REQUEST, "invalid", "请求内容不符合要求", {
    issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  });
}
