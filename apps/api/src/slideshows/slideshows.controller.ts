import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { SlideshowsService } from "./slideshows.service";

@Controller("spaces/:spaceId/slideshows")
@UseGuards(AuthGuard)
export class SlideshowsController {
  constructor(private readonly slideshows: SlideshowsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.slideshows.list(user.id, spaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.slideshows.create(user.id, spaceId, {
      title: body.title as string | undefined,
      albumId: body.albumId as string | undefined,
      mediaAssetIds: body.mediaAssetIds as string[] | undefined,
      stayDurationMs: body.stayDurationMs as number | undefined,
      transition: body.transition as string | undefined,
      background: body.background as string | undefined,
      loop: body.loop as boolean | undefined,
      random: body.random as boolean | undefined,
      captions: body.captions as boolean | undefined,
      showDate: body.showDate as boolean | undefined,
      showLocation: body.showLocation as boolean | undefined,
      musicUrl: body.musicUrl as string | undefined,
    });
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.slideshows.get(user.id, spaceId, id);
  }
}
