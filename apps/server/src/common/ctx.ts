import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Permission, Role } from "@platerelay/shared";
import type { Request } from "express";

/** A signed-in user. */
export interface UserActor {
  type: "USER";
  id: string;
  username: string;
  displayName: string;
  role: Role;
  permissions: ReadonlySet<Permission>;
}

/** Someone not signed in, while the overview is public. */
export interface GuestActor {
  type: "GUEST";
  id: null;
  permissions: ReadonlySet<Permission>;
}

/** The panel itself, a daemon, or a printer's own report. */
export interface MachineActor {
  type: "SYSTEM" | "DAEMON" | "PRINTER";
  id: string | null;
  permissions: ReadonlySet<Permission>;
}

export type Actor = UserActor | GuestActor | MachineActor;

/** Who is acting and from where. Services take this so records and the audit log are complete. */
export interface Ctx {
  actor: Actor;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

const NONE: ReadonlySet<Permission> = new Set();

export const SYSTEM: Ctx = { actor: { type: "SYSTEM", id: null, permissions: NONE }, ip: null, userAgent: null, requestId: null };
export const daemonCtx = (daemonId: string): Ctx => ({ actor: { type: "DAEMON", id: daemonId, permissions: NONE }, ip: null, userAgent: null, requestId: null });
export const printerCtx = (printerId: string): Ctx => ({ actor: { type: "PRINTER", id: printerId, permissions: NONE }, ip: null, userAgent: null, requestId: null });

export const can = (ctx: Ctx, p: Permission) => ctx.actor.permissions.has(p);
export const userIdOf = (ctx: Ctx) => (ctx.actor.type === "USER" ? ctx.actor.id : null);
/** Actor columns of records and the audit log; a guest is recorded as the system. */
export const actorColumns = (ctx: Ctx) => ({ actorType: ctx.actor.type === "GUEST" ? ("SYSTEM" as const) : ctx.actor.type, actorId: ctx.actor.id });

export type PanelRequest = Request & { ctx?: Ctx; requestId?: string; sessionToken?: string };

/** Injects the request's Ctx into a handler. */
export const ReqCtx = createParamDecorator((_: unknown, ec: ExecutionContext) => ec.switchToHttp().getRequest<PanelRequest>().ctx!);
