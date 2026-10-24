import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { Response } from "express";

/**
 * A refusal the client can act on. Serialized as {code, message, ...extra},
 * the same shape the parse endpoint already answers with.
 */
export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ ...extra, code, message }, status);
  }
}

export const notFound = (what = "资源") => new ApiError(HttpStatus.NOT_FOUND, "not-found", `${what}不存在`);

/** Turns every error into {code, message}; unexpected ones are logged and hidden. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const body = e.getResponse();
      const status = e.getStatus();
      if (typeof body === "object" && body && "code" in body) return res.status(status).json(body);
      const message = typeof body === "string" ? body : ((body as { message?: unknown }).message ?? e.message);
      return res.status(status).json({ code: `http-${status}`, message: Array.isArray(message) ? message.join("; ") : String(message) });
    }
    this.log.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    res.status(500).json({ code: "internal", message: "服务器内部错误" });
  }
}
