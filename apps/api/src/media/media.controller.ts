import { Controller, Delete, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { MediaService } from "./media.service";

@Controller("spaces/:spaceId/media")
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("view") view?: string,
    @Query("q") q?: string,
  ) {
    return this.media.list(user.id, spaceId, { cursor, limit: limit ? Number(limit) : undefined, view, q });
  }

  @Get(":id")
  detail(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.media.detail(user.id, spaceId, id);
  }

  @Get(":id/file")
  async file(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("id") id: string,
    @Query("v") v: string,
    @Res() res: Response,
  ) {
    const variant = v || "thumbnail";
    const capability = variant === "original" ? "download_original" : "view_media";
    const out = await this.media.fileBuffer(user.id, spaceId, id, variant, capability);
    res.setHeader("Content-Type", out.mime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(out.buf);
  }

  @Get(":id/download")
  async download(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("id") id: string,
    @Query("variant") variant: string,
    @Res() res: Response,
  ) {
    const v = variant === "original" ? "original" : "optimized";
    const out = await this.media.download(user.id, spaceId, id, v);
    res.setHeader("Content-Type", out.mime);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(out.filename)}"`);
    res.send(out.buf);
  }

  @Delete(":id")
  trash(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.media.trash(user.id, spaceId, id);
  }

  @Post(":id/restore")
  restore(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.media.restore(user.id, spaceId, id);
  }

  @Post(":id/retry")
  retry(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.media.retry(user.id, spaceId, id);
  }

  @Post(":id/favorite")
  fav(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.media.toggleFavorite(user.id, spaceId, id, true);
  }

  @Delete(":id/favorite")
  unfav(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.media.toggleFavorite(user.id, spaceId, id, false);
  }
}
