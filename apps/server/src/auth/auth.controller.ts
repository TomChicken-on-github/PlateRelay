import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { ApiError } from "../common/errors.js";
import { APP_CONFIG, type AppConfig } from "../config/config.js";
import { parse } from "../common/zod.js";
import { SettingsService } from "../settings/settings.service.js";
import { type AuthedRequest, type Ctx, Public, ReqCtx, type UserActor } from "./actor.js";
import { AuthService, SESSION_COOKIE, SESSION_TTL_MS } from "./auth.service.js";

const Credentials = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });
const Register = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N}_.-]{2,32}$/u, "2–32 位，只能用字母、数字、_ . -"),
  displayName: z.string().trim().min(1).max(32),
  password: z.string().min(8, "密码至少 8 位").max(256),
});

export const meView = (a: UserActor) => ({
  id: a.id,
  username: a.username,
  displayName: a.displayName,
  role: { id: a.roleId, name: a.roleName },
  permissions: [...a.permissions].sort(),
});

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: this.config.secureCookies, maxAge: SESSION_TTL_MS, path: "/" });
  }

  @Public()
  @Post("register")
  async register(@ReqCtx() ctx: Ctx, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    if (!(await this.settings.get("auth.registration")).enabled) throw new ApiError(HttpStatus.FORBIDDEN, "registration-closed", "未开放注册");
    const b = parse(Register, body);
    await this.auth.createUser(ctx, { ...b, role: "user" });
    const { token, actor } = await this.auth.login(ctx, b.username, b.password);
    this.setCookie(res, token);
    return meView(actor);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@ReqCtx() ctx: Ctx, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parse(Credentials, body);
    const { token, actor } = await this.auth.login(ctx, b.username, b.password);
    this.setCookie(res, token);
    return meView(actor);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@ReqCtx() ctx: Ctx, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx, String(req.cookies[SESSION_COOKIE]));
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  me(@Req() req: AuthedRequest) {
    return meView(req.actor!);
  }
}
