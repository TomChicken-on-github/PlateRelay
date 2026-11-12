import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * A refusal the client can act on, sent as RFC 9457 application/problem+json. `code` is what the
 * front end looks its message up by; `detail` is English for developers and is never shown.
 */
export class Problem extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly detail?: string,
    readonly params?: Record<string, unknown>,
    readonly errors?: { path: string; code: string; params?: Record<string, unknown> }[],
  ) {
    super(code, status);
  }
}

export const badRequest = (detail: string) => new Problem(400, "bad_request", detail);
export const unauthenticated = () => new Problem(401, "unauthenticated");
export const forbidden = (detail?: string) => new Problem(403, "forbidden", detail);
/** Also the answer for things the caller may not see, so their existence does not leak. */
export const notFound = (what = "resource") => new Problem(404, "not_found", `${what} not found`);
export const stateConflict = (current: string, expected?: string) => new Problem(409, "state_conflict", expected ? `is ${current}, expected ${expected}` : `not possible while ${current}`, { current });
export const jobMismatch = (currentJobId: string | null) => new Problem(409, "job_mismatch", "the current job is not the one the request names", { currentJobId });
export const versionConflict = (currentVersion: number | string, current?: unknown) => new Problem(409, "version_conflict", "edited by someone else meanwhile", { currentVersion, current });
export const printerUnreachable = () => new Problem(409, "printer_unreachable", "the printer's daemon is not connected");
export const ruleViolation = (detail: string, params?: Record<string, unknown>) => new Problem(422, "rule_violation", detail, params);
export const validationFailed = (errors: { path: string; code: string; params?: Record<string, unknown> }[]) => new Problem(422, "validation_failed", "request does not match the contract", undefined, errors);

const TYPE_BASE = "https://platerelay.dev/errors/";

export function problemBody(status: number, code: string, requestId: string, p?: Pick<Problem, "detail" | "params" | "errors">) {
  return {
    type: TYPE_BASE + code,
    title: code,
    status,
    code,
    ...(p?.detail ? { detail: p.detail } : {}),
    ...(p?.params ? { params: p.params } : {}),
    ...(p?.errors ? { errors: p.errors } : {}),
    requestId,
  };
}

const HTTP_CODES: Record<number, string> = { 400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found", 413: "payload_too_large", 415: "unsupported_file", 429: "rate_limited" };

/** Turns every error into a problem document; unexpected ones are logged and hidden behind the request id. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(e: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const requestId = String(http.getRequest<Request & { requestId?: string }>().requestId ?? "");
    const send = (status: number, body: object) => res.status(status).type("application/problem+json").send(JSON.stringify(body));
    if (e instanceof Problem) return send(e.getStatus(), problemBody(e.getStatus(), e.code, requestId, e));
    if (e instanceof HttpException) {
      const status = e.getStatus();
      return send(status, problemBody(status, HTTP_CODES[status] ?? (status >= 500 ? "internal" : "bad_request"), requestId, status < 500 ? { detail: e.message } : undefined));
    }
    this.log.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    send(500, problemBody(500, "internal", requestId));
  }
}
