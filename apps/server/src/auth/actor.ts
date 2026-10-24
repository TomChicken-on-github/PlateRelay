import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Permission } from "@platerelay/shared";
import type { Request } from "express";

/** The signed-in user a request acts as. */
export interface UserActor {
  type: "user";
  id: string;
  username: string;
  displayName: string;
  roleId: string;
  roleName: string;
  permissions: ReadonlySet<Permission>;
}

/** Non-human actors in the audit log and order timeline. */
export type SystemActor = { type: "system" | "daemon" | "printer"; id?: string | null };

export type Actor = UserActor | SystemActor;

/** Who did it and from where; services take this so the audit log is complete. */
export interface Ctx {
  actor: Actor;
  ip: string | null;
  device: string | null;
}

export const SYSTEM: Ctx = { actor: { type: "system" }, ip: null, device: null };

export const can = (ctx: Ctx, p: Permission) => ctx.actor.type === "user" && ctx.actor.permissions.has(p);
export const userId = (ctx: Ctx) => (ctx.actor.type === "user" ? ctx.actor.id : null);

export type AuthedRequest = Request & { actor?: UserActor };

export function ctxOf(req: AuthedRequest): Ctx {
  return {
    actor: req.actor ?? { type: "system" },
    ip: req.ip ?? null,
    device: req.get("user-agent")?.slice(0, 200) ?? null,
  };
}

/** Injects the request's Ctx into a handler. */
export const ReqCtx = createParamDecorator((_: unknown, ec: ExecutionContext) => ctxOf(ec.switchToHttp().getRequest<AuthedRequest>()));

export const PUBLIC = "platerelay:public";
export const PERMS = "platerelay:perms";

/** No sign-in needed. */
export const Public = () => SetMetadata(PUBLIC, true);

/** Signed in and holding at least one of the nodes. */
export const RequirePerm = (...p: Permission[]) => SetMetadata(PERMS, p);
