import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user";
import { RequestUser } from "../auth/auth.service";
import { LibraryService } from "./library.service";

@Controller("spaces/:spaceId")
@UseGuards(AuthGuard)
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get("folders")
  folders(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.library.listFolders(user.id, spaceId);
  }

  @Post("folders")
  createFolder(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body() body: { name?: string; parentId?: string },
  ) {
    return this.library.createFolder(user.id, spaceId, body.name || "", body.parentId);
  }

  @Get("albums")
  albums(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.library.listAlbums(user.id, spaceId);
  }

  @Post("albums")
  createAlbum(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Body() body: { name?: string; description?: string },
  ) {
    return this.library.createAlbum(user.id, spaceId, body);
  }

  @Get("albums/:albumId")
  getAlbum(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("albumId") albumId: string,
  ) {
    return this.library.getAlbum(user.id, spaceId, albumId);
  }

  @Post("albums/:albumId/items")
  addItems(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("albumId") albumId: string,
    @Body() body: { mediaAssetIds?: string[] },
  ) {
    return this.library.addAlbumItems(user.id, spaceId, albumId, body.mediaAssetIds || []);
  }

  @Get("tags")
  tags(@CurrentUser() user: RequestUser, @Param("spaceId") spaceId: string) {
    return this.library.listTags(user.id, spaceId);
  }

  @Post("media/:id/tags")
  tag(
    @CurrentUser() user: RequestUser,
    @Param("spaceId") spaceId: string,
    @Param("id") id: string,
    @Body() body: { name?: string },
  ) {
    return this.library.tagMedia(user.id, spaceId, id, body.name || "");
  }
}
