import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import { Request, Response } from "express";
import { SharesService } from "../shares/shares.service";
import { PresentationsService } from "../presentations/presentations.service";
import { StorageService } from "../storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { readCookie, SESSION_COOKIE } from "../common/cookies";

@Controller("public")
export class PublicController {
  constructor(
    private readonly shares: SharesService,
    private readonly presentations: PresentationsService,
    private readonly auth: AuthService,
    private readonly storage: StorageService,
  ) {}

  private async viewer(req: Request, token: string) {
    const sessionCookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    const user = sessionCookie ? await this.auth.resolveSession(sessionCookie) : null;
    const shareSession = readCookie(req.headers.cookie, this.shares.cookieName(token));
    const passwordVerified = await this.shares.sessionValid(token, shareSession);
    return { userId: user?.id || null, passwordVerified };
  }

  @Get("shares/:token")
  async share(@Param("token") token: string, @Req() req: Request) {
    const viewer = await this.viewer(req, token);
    return this.shares.payload(token, viewer);
  }

  @Post("shares/:token/password")
  async password(
    @Param("token") token: string,
    @Body() body: { password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.shares.verifyPassword(token, body.password || "");
    res.cookie(out.cookieName, out.raw, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 3600 * 1000,
    });
    return { ok: true };
  }

  @Get("shares/:token/file")
  async file(
    @Param("token") token: string,
    @Query("v") v: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const viewer = await this.viewer(req, token);
    const out = await this.shares.shareFile(token, undefined, v || "thumbnail", viewer);
    res.setHeader("Content-Type", out.mime);
    res.send(out.buf);
  }

  @Get("shares/:token/file/:mediaId")
  async fileMedia(
    @Param("token") token: string,
    @Param("mediaId") mediaId: string,
    @Query("v") v: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const viewer = await this.viewer(req, token);
    const out = await this.shares.shareFile(token, mediaId, v || "thumbnail", viewer);
    res.setHeader("Content-Type", out.mime);
    res.send(out.buf);
  }

  @Get("presentations/:publishToken")
  presentation(@Param("publishToken") publishToken: string) {
    return this.presentations.publicByToken(publishToken);
  }

  @Get("presentations/:publishToken/file/:mediaId")
  async presentationFile(
    @Param("publishToken") publishToken: string,
    @Param("mediaId") mediaId: string,
    @Res() res: Response,
  ) {
    const version = await this.presentations.publicFile(publishToken, mediaId);
    const buf = await this.storage.getObject(version.objectKey);
    res.setHeader("Content-Type", version.mimeType);
    res.send(buf);
  }
}
