import { Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { AuthService, clearSessionCookie, setSessionCookie } from "./auth.service";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { rateLimit } from "../common/rate-limit";
import { fail } from "../domain/errors";
import type { RequestUser } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  async register(
    @Body() body: { email?: string; password?: string; displayName?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    rateLimit(`reg:${req.ip}`, 10, 10 * 60 * 1000);
    const out = await this.auth.register({
      email: body.email || "",
      password: body.password || "",
      displayName: body.displayName,
    });
    setSessionCookie(res, out.rawToken);
    return out.user;
  }

  @Post("login")
  async login(
    @Body() body: { email?: string; password?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    rateLimit(`login:${req.ip}:${(body.email || "").toLowerCase()}`, 20, 10 * 60 * 1000);
    const out = await this.auth.login({ email: body.email || "", password: body.password || "" });
    setSessionCookie(res, out.rawToken);
    return out.user;
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(@CurrentUser() user: RequestUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId);
    clearSessionCookie(res);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: RequestUser) {
    return this.auth.publicUser(user.id);
  }

  @Post("magic-link")
  async magicLink(@Body() body: { email?: string }, @Req() req: Request) {
    rateLimit(`magic:${req.ip}`, 10, 10 * 60 * 1000);
    return this.auth.requestMagicLink(body.email || "");
  }

  @Get("magic-link/consume")
  async consumeMagic(@Query("token") token: string, @Res({ passthrough: true }) res: Response) {
    const out = await this.auth.consumeMagicLink(token || "");
    setSessionCookie(res, out.rawToken);
    return out.user;
  }

  @Get("oauth/:provider")
  oauthStart(@Param("provider") provider: string, @Res() res: Response) {
    const url = this.auth.oauthStartUrl(provider);
    res.redirect(url);
  }

  @Get("oauth/:provider/callback")
  oauthCallback() {
    fail("AUTH_OAUTH_NOT_CONFIGURED");
  }

  @Post("password/change")
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    await this.auth.changePassword(user.id, body.currentPassword || "", body.newPassword || "");
    return { ok: true };
  }

  @Get("sessions")
  @UseGuards(AuthGuard)
  sessions(@CurrentUser() user: RequestUser) {
    return this.auth.listSessions(user.id);
  }

  @Delete("sessions/:id")
  @UseGuards(AuthGuard)
  async revoke(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    await this.auth.revokeSession(user.id, id);
    return { ok: true };
  }
}
