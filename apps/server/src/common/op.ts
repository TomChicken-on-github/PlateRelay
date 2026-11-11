import { applyDecorators, type CanActivate, type ExecutionContext, Injectable, RequestMapping, RequestMethod, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isPermission } from "@platerelay/shared";
import { type OperationId, operations, validateRequestBody } from "@platerelay/shared/contract/http";
import { AuditService } from "../audit/audit.service.js";
import { AuthService, SESSION_COOKIE } from "../auth/auth.service.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import type { PanelRequest } from "./ctx.js";
import { forbidden, Problem, unauthenticated, validationFailed } from "./problem.js";
import { Inject } from "@nestjs/common";

export const OP = "platerelay:operation";

/**
 * Binds a handler to one operation of the API contract. Method, path and required permissions all
 * come from the contract, so a route cannot drift from it; the guard below also checks the JSON
 * body against the contract before the handler runs.
 */
export function Op(id: OperationId) {
  const op = operations[id];
  return applyDecorators(RequestMapping({ path: op.path.replace(/\{(\w+)\}/g, ":$1"), method: RequestMethod[op.method as keyof typeof RequestMethod] }), SetMetadata(OP, id));
}

export const opOf = (req: PanelRequest): OperationId | undefined => (req as PanelRequest & { operationId?: OperationId }).operationId;

/**
 * Global guard for the browser API: works out who is calling (session cookie, otherwise a guest),
 * refuses cross-site writes, checks the operation's permission and validates the body. Routes
 * without an operation (the daemon's own endpoints, signed file links) do their own checks.
 */
@Injectable()
export class ApiGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const req = ec.switchToHttp().getRequest<PanelRequest>();
    const id = this.reflector.get<OperationId | undefined>(OP, ec.getHandler());
    const base = { ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 200) ?? null, requestId: req.requestId ?? null };
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === "string" && token ? await this.auth.actorForSession(token) : null;
    if (user) req.sessionToken = token as string;
    req.ctx = { ...base, actor: user ?? (await this.auth.guest()) };
    if (!id) return true;
    (req as PanelRequest & { operationId?: OperationId }).operationId = id;
    const op = operations[id];

    if (op.method !== "GET" && !this.sameSite(req)) throw new Problem(403, "origin_rejected", "write requests must come from the panel's own pages");

    const need = op.permissions as readonly string[];
    const allowed = need.includes("public") || (user ? need.includes("authenticated") || need.some((p) => isPermission(p) && user.permissions.has(p)) : need.includes("guest") && req.ctx.actor.permissions.has("overview:view"));
    if (!allowed) {
      if (!user) throw unauthenticated();
      if (op.method !== "GET") await this.audit.record(req.ctx, { action: id, result: "DENIED", reason: `needs ${need.join(" or ")}` });
      throw forbidden();
    }

    if (op.hasJsonBody) {
      const r = validateRequestBody(id, req.body ?? {});
      if (!r.ok) throw validationFailed(r.issues);
    }
    return true;
  }

  /* No CSRF token: writes are accepted only from the panel's own origin, and the cookie is SameSite=Lax. */
  private sameSite(req: PanelRequest): boolean {
    const origin = req.get("origin");
    if (origin) return origin === this.config.publicOrigin || origin === `${req.protocol}://${req.get("host")}`;
    const site = req.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  }
}
