import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { SpacesService } from "./spaces.service";

@Controller("spaces")
@UseGuards(AuthGuard)
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.spaces.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() body: { name?: string; type?: string }) {
    return this.spaces.create(user.id, body);
  }

  @Get(":spaceId")
  get(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.spaces.get(user.id, spaceId);
  }

  @Delete(":spaceId")
  remove(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.spaces.deleteSpace(user.id, spaceId);
  }

  @Post(":spaceId/transfer")
  transfer(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body() body: { userId?: string },
  ) {
    return this.spaces.transfer(user.id, spaceId, body.userId || "");
  }

  @Get(":spaceId/members")
  members(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.spaces.members(user.id, spaceId);
  }

  @Post(":spaceId/members")
  addMember(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body() body: { email?: string; role?: string },
  ) {
    return this.spaces.addMember(user.id, spaceId, body.email || "", body.role || "VIEWER");
  }

  @Patch(":spaceId/members/:userId")
  updateMember(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("userId") userId: string,
    @Body() body: { role?: string },
  ) {
    return this.spaces.updateMember(user.id, spaceId, userId, body.role || "VIEWER");
  }

  @Delete(":spaceId/members/:userId")
  removeMember(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("userId") userId: string,
  ) {
    return this.spaces.removeMember(user.id, spaceId, userId);
  }
}
