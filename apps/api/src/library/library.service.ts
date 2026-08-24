import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AccessService } from "../spaces/access.service";
import { fail } from "../domain/errors";

@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async listFolders(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    return this.prisma.folder.findMany({ where: { spaceId }, orderBy: { name: "asc" } });
  }

  async createFolder(userId: string, spaceId: string, name: string, parentId?: string) {
    await this.access.require(userId, spaceId, "create_folder");
    return this.prisma.folder.create({
      data: { spaceId, name: name.trim() || "未命名文件夹", parentId: parentId || null },
    });
  }

  async moveMedia(userId: string, spaceId: string, mediaId: string, folderId: string | null) {
    await this.access.require(userId, spaceId, "edit_media");
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, spaceId } });
    if (!asset) fail("MEDIA_NOT_FOUND");
    return this.prisma.mediaAsset.update({ where: { id: mediaId }, data: { folderId } });
  }

  async listAlbums(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    const albums = await this.prisma.album.findMany({
      where: { spaceId },
      include: {
        _count: { select: { items: true } },
        items: { take: 1, orderBy: { sortOrder: "asc" }, select: { mediaAssetId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return albums.map((a) => {
      const coverId = a.coverAssetId || a.items[0]?.mediaAssetId || null;
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        coverAssetId: coverId,
        itemCount: a._count.items,
        coverUrl: coverId ? `/spaces/${spaceId}/media/${coverId}/file?v=thumbnail` : null,
      };
    });
  }

  async createAlbum(userId: string, spaceId: string, input: { name?: string; description?: string }) {
    await this.access.require(userId, spaceId, "create_album");
    return this.prisma.album.create({
      data: { spaceId, name: input.name?.trim() || "未命名相册", description: input.description },
    });
  }

  async addAlbumItems(userId: string, spaceId: string, albumId: string, mediaAssetIds: string[]) {
    await this.access.require(userId, spaceId, "edit_media");
    const album = await this.prisma.album.findFirst({ where: { id: albumId, spaceId } });
    if (!album) fail("MEDIA_NOT_FOUND");
    const existing = await this.prisma.albumItem.count({ where: { albumId } });
    const unique = [...new Set(mediaAssetIds)];
    const assets = await this.prisma.mediaAsset.findMany({
      where: { spaceId, id: { in: unique } },
      select: { id: true },
    });
    let order = existing;
    for (const a of assets) {
      await this.prisma.albumItem.upsert({
        where: { albumId_mediaAssetId: { albumId, mediaAssetId: a.id } },
        create: { albumId, mediaAssetId: a.id, sortOrder: order++ },
        update: {},
      });
    }
    return this.getAlbum(userId, spaceId, albumId);
  }

  async getAlbum(userId: string, spaceId: string, albumId: string) {
    await this.access.require(userId, spaceId, "view_media");
    const album = await this.prisma.album.findFirst({
      where: { id: albumId, spaceId },
      include: { items: { orderBy: { sortOrder: "asc" }, include: { media: true } } },
    });
    if (!album) fail("MEDIA_NOT_FOUND");
    return {
      id: album.id,
      name: album.name,
      description: album.description,
      items: album.items
        .filter((i) => i.media.status !== "TRASHED" && i.media.status !== "PURGED")
        .map((i) => ({
          id: i.media.id,
          width: i.media.width,
          height: i.media.height,
          status: i.media.status,
          thumbnailUrl: `/spaces/${spaceId}/media/${i.media.id}/file?v=thumbnail`,
        })),
    };
  }

  async listTags(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    return this.prisma.tag.findMany({ where: { spaceId }, orderBy: { name: "asc" } });
  }

  async tagMedia(userId: string, spaceId: string, mediaId: string, name: string) {
    await this.access.require(userId, spaceId, "edit_media");
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, spaceId } });
    if (!asset) fail("MEDIA_NOT_FOUND");
    const tag = await this.prisma.tag.upsert({
      where: { spaceId_name: { spaceId, name: name.trim() } },
      create: { spaceId, name: name.trim(), source: "user" },
      update: {},
    });
    await this.prisma.mediaTag.upsert({
      where: { mediaAssetId_tagId: { mediaAssetId: mediaId, tagId: tag.id } },
      create: { mediaAssetId: mediaId, tagId: tag.id, source: "user" },
      update: {},
    });
    return tag;
  }
}
