import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@platerelay/shared";
import { AuditService } from "../audit/audit.service.js";
import { ApiError } from "../common/errors.js";
import { type AuthedRequest, ctxOf, PERMS, PUBLIC } from "./actor.js";
import { AuthService, SESSION_COOKIE } from "./auth.service.js";

/**
 * Global guard: resolves the session cookie, then checks the handler's
 * @RequirePerm nodes. Refusals of signed-in users go to the audit log.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const req = ec.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    if (typeof token === "string" && token) req.actor = (await this.auth.actorForSession(token)) ?? undefined;

    const targets = [ec.getHandler(), ec.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    if (!req.actor) throw new ApiError(HttpStatus.UNAUTHORIZED, "unauthenticated", "请先登录");

    const need = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets);
    if (!need?.length || need.some((p) => req.actor!.permissions.has(p))) return true;
    await this.audit.record(ctxOf(req), { action: `${req.method} ${req.route?.path ?? req.path}`, reason: `缺少权限 ${need.join(" / ")}`, result: "denied" });
    throw new ApiError(HttpStatus.FORBIDDEN, "forbidden", "没有权限执行这个操作");
  }
}
