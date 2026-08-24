import { Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { SharesService } from "./shares.service";

@Controller("spaces/:spaceId/shares")
@UseGuards(AuthGuard)
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.shares.list(user.id, spaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.shares.create(user.id, spaceId, {
      targetType: body.targetType as string,
      targetId: body.targetId as string,
      accessMode: body.accessMode as string,
      password: body.password as string,
      expiresAt: body.expiresAt as string,
      maxViews: body.maxViews as number,
      allowDownloadOptimized: body.allowDownloadOptimized as boolean,
      allowDownloadOriginal: body.allowDownloadOriginal as boolean,
      showExif: body.showExif as boolean,
      showGps: body.showGps as boolean,
    });
  }

  @Delete(":shareId")
  revoke(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("shareId") shareId: string,
  ) {
    return this.shares.revoke(user.id, spaceId, shareId);
  }
}
