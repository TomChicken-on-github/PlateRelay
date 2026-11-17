import { type components, createApiClient } from "@platerelay/shared/api";

export type Schemas = components["schemas"];
export type Problem = Schemas["Problem"];

/*
 * Typed client for the panel API. Every write carries a fresh Idempotency-Key, so a retried request is
 * not applied twice. A 401 on anything but sign-in means the session ended: the app goes back to sign-in.
 */
export const client = createApiClient();

let onSignedOut = () => {};
export const setSignedOutHandler = (f: () => void) => void (onSignedOut = f);

client.use({
  onRequest({ request }) {
    if (request.method !== "GET" && !request.headers.has("Idempotency-Key")) request.headers.set("Idempotency-Key", crypto.randomUUID());
    return request;
  },
  onResponse({ request, response }) {
    if (response.status === 401 && !new URL(request.url).pathname.endsWith("/auth/login")) onSignedOut();
    return response;
  },
});

/** Header params for a write: a fresh Idempotency-Key. */
export const idem = () => ({ header: { "Idempotency-Key": crypto.randomUUID() } });

/** Error thrown by `unwrap`: the server's problem, or a network failure. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly problem?: Problem,
  ) {
    super(problem?.detail ?? code);
  }
}

/** Turns an openapi-fetch result into its data, or throws an ApiError. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let r: Awaited<typeof call>;
  try {
    r = await call;
  } catch {
    throw new ApiError("network", 0);
  }
  if (r.error !== undefined || !r.response.ok) {
    const p = r.error as Problem | undefined;
    throw new ApiError(typeof p?.code === "string" ? p.code : "http_" + r.response.status, r.response.status, p);
  }
  return r.data as T;
}

const MESSAGES: Record<string, string> = {
  network: "连不上服务器",
  bad_credentials: "用户名或密码错误",
  rate_limited: "尝试次数过多，请稍后再试",
  username_taken: "用户名已被使用",
  forbidden: "没有权限",
  validation_failed: "填写的内容有误",
};

/** Chinese text for an error, by its code. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return MESSAGES[e.code] ?? `出错了（${e.code}）`;
  return "出错了";
}
