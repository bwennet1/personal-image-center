import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { PresentationsService } from "./presentations.service";

@Controller("spaces/:spaceId/presentations")
@UseGuards(AuthGuard)
export class PresentationsController {
  constructor(private readonly presentations: PresentationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.presentations.list(user.id, spaceId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body()
    body: { title?: string; preset?: string; mediaAssetIds?: string[]; coverAssetId?: string; musicUrl?: string },
  ) {
    return this.presentations.create(user.id, spaceId, body);
  }

  @Get(":id")
  get(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.presentations.get(user.id, spaceId, id);
  }

  @Post(":id/publish")
  publish(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string, @Param("id") id: string) {
    return this.presentations.publish(user.id, spaceId, id);
  }
}
