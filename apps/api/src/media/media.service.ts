import { Injectable } from "@nestjs/common";
import { MediaStatus, Prisma, VersionType } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { StorageService } from "../storage/storage.service";
import { AccessService } from "../spaces/access.service";
import { fail } from "../domain/errors";
import { processImageJob } from "./media-processor";
import { Capability } from "../domain/capabilities";

const LIBRARY_STATUSES: MediaStatus[] = [MediaStatus.READY, MediaStatus.PARTIAL_READY];
const LIBRARY_WITH_INFLIGHT: MediaStatus[] = [
  MediaStatus.READY,
  MediaStatus.PARTIAL_READY,
  MediaStatus.PROCESSING,
  MediaStatus.UPLOADED,
];

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
  ) {}

  async list(
    userId: string,
    spaceId: string,
    query: { cursor?: string; limit?: number; view?: string; q?: string },
  ) {
    await this.access.require(userId, spaceId, "view_media");
    const limit = Math.min(Math.max(Number(query.limit) || 40, 1), 100);
    const view = query.view || "library";
    const q = (query.q || "").trim();
    const where: Prisma.MediaAssetWhereInput = { spaceId };
    if (view === "trash") where.status = MediaStatus.TRASHED;
    else if (view === "failed") where.status = MediaStatus.PROCESSING_FAILED;
    else if (view === "favorites") {
      where.status = { in: LIBRARY_STATUSES };
      where.favorites = { some: { userId } };
    } else {
      where.status = { in: LIBRARY_WITH_INFLIGHT };
    }

    const and: Prisma.MediaAssetWhereInput[] = [];
    if (q) {
      and.push({
        OR: [
          { originalFilename: { contains: q, mode: "insensitive" } },
          { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } },
        ],
      });
    }
    if (query.cursor) {
      const [ts, id] = Buffer.from(query.cursor, "base64url").toString("utf8").split("|");
      const capturedAt = new Date(ts);
      and.push({
        OR: [{ capturedAt: { lt: capturedAt } }, { capturedAt, id: { lt: id } }],
      });
    }
    if (and.length) where.AND = and;

    const rows = await this.prisma.mediaAsset.findMany({
      where,
      orderBy: [{ capturedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        width: true,
        height: true,
        capturedAt: true,
        uploadedAt: true,
        status: true,
        originalFilename: true,
        mimeType: true,
        favorites: { where: { userId }, select: { userId: true } },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? Buffer.from(`${page[page.length - 1].capturedAt?.toISOString() || ""}|${page[page.length - 1].id}`).toString(
          "base64url",
        )
      : null;
    return {
      items: page.map((r) => ({
        id: r.id,
        width: r.width,
        height: r.height,
        capturedAt: r.capturedAt,
        uploadedAt: r.uploadedAt,
        status: r.status,
        favorite: r.favorites.length > 0,
        thumbnailUrl: `/spaces/${spaceId}/media/${r.id}/file?v=thumbnail`,
      })),
      nextCursor,
      hasMore,
    };
  }

  async detail(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "view_media");
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, spaceId },
      include: { versions: true, albumItems: { include: { album: true } }, tags: { include: { tag: true } } },
    });
    if (!asset) fail("MEDIA_NOT_FOUND");
    const fav = await this.prisma.favorite.findUnique({
      where: { userId_mediaAssetId: { userId, mediaAssetId: id } },
    });
    return {
      id: asset.id,
      spaceId: asset.spaceId,
      originalFilename: asset.originalFilename,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      capturedAt: asset.capturedAt,
      uploadedAt: asset.uploadedAt,
      status: asset.status,
      failureReason: asset.failureReason,
      latitude: asset.latitude,
      longitude: asset.longitude,
      locationText: asset.locationText,
      exifSummary: asset.exifSummary,
      favorite: Boolean(fav),
      albums: asset.albumItems.map((i) => ({ id: i.album.id, name: i.album.name })),
      tags: asset.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, source: t.source })),
      versions: asset.versions.map((v) => ({
        versionType: v.versionType,
        width: v.width,
        height: v.height,
        bytes: Number(v.bytes),
        mimeType: v.mimeType,
        storageProvider: v.storageProvider,
      })),
      fileUrls: {
        thumbnail: `/spaces/${spaceId}/media/${id}/file?v=thumbnail`,
        optimized_1280: `/spaces/${spaceId}/media/${id}/file?v=optimized_1280`,
        optimized_2560: `/spaces/${spaceId}/media/${id}/file?v=optimized_2560`,
      },
    };
  }

  async fileBuffer(
    userId: string,
    spaceId: string,
    id: string,
    variant: string,
    capability: Capability = "view_media",
  ) {
    await this.access.require(userId, spaceId, capability);
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, spaceId },
      include: { versions: true },
    });
    if (!asset) fail("MEDIA_NOT_FOUND");
    const wanted = this.pickVersion(asset.versions, variant);
    if (!wanted) fail("MEDIA_NOT_FOUND");
    const buf = await this.storage.getObject(wanted.objectKey);
    return { buf, mime: wanted.mimeType, filename: asset.originalFilename, versionType: wanted.versionType };
  }

  pickVersion(
    versions: { versionType: VersionType; objectKey: string; mimeType: string; bytes: bigint }[],
    variant: string,
  ) {
    const byType = (t: VersionType) => versions.find((v) => v.versionType === t);
    if (variant === "original") return byType(VersionType.ORIGINAL);
    if (variant === "thumbnail") return byType(VersionType.THUMBNAIL);
    if (variant === "optimized_1280") return byType(VersionType.OPTIMIZED_1280);
    if (variant === "optimized_2560") return byType(VersionType.OPTIMIZED_2560);
    if (variant === "optimized") {
      return byType(VersionType.OPTIMIZED_2560) || byType(VersionType.OPTIMIZED_1280) || byType(VersionType.THUMBNAIL);
    }
    return byType(VersionType.THUMBNAIL);
  }

  async download(userId: string, spaceId: string, id: string, variant: "optimized" | "original") {
    const cap: Capability = variant === "original" ? "download_original" : "download_optimized";
    const out = await this.fileBuffer(userId, spaceId, id, variant, cap);
    if (variant === "original" && out.versionType !== VersionType.ORIGINAL) fail("MEDIA_ORIGINAL_NOT_AVAILABLE");
    return out;
  }

  async trash(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "delete_media");
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, spaceId } });
    if (!asset) fail("MEDIA_NOT_FOUND");
    await this.prisma.mediaAsset.update({
      where: { id },
      data: {
        status: MediaStatus.TRASHED,
        trashedAt: new Date(),
        statusBeforeTrash: asset.status,
      },
    });
    await this.prisma.auditLog.create({
      data: { spaceId, actorId: userId, action: "media.trash", target: id },
    });
    return { ok: true, status: MediaStatus.TRASHED };
  }

  async restore(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "delete_media");
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, spaceId } });
    if (!asset) fail("MEDIA_NOT_FOUND");
    const next =
      asset.statusBeforeTrash && asset.statusBeforeTrash !== MediaStatus.TRASHED
        ? asset.statusBeforeTrash
        : MediaStatus.READY;
    await this.prisma.mediaAsset.update({
      where: { id },
      data: { status: next, trashedAt: null, statusBeforeTrash: null },
    });
    await this.prisma.auditLog.create({
      data: { spaceId, actorId: userId, action: "media.restore", target: id },
    });
    return { ok: true, status: next };
  }

  async retry(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "edit_media");
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, spaceId } });
    if (!asset) fail("MEDIA_NOT_FOUND");
    await processImageJob({ prisma: this.prisma, storage: this.storage }, id);
    return this.prisma.mediaAsset.findUnique({ where: { id }, include: { versions: true } });
  }

  async toggleFavorite(userId: string, spaceId: string, id: string, on: boolean) {
    await this.access.require(userId, spaceId, "view_media");
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, spaceId } });
    if (!asset) fail("MEDIA_NOT_FOUND");
    if (on) {
      await this.prisma.favorite.upsert({
        where: { userId_mediaAssetId: { userId, mediaAssetId: id } },
        create: { userId, mediaAssetId: id, spaceId },
        update: {},
      });
    } else {
      await this.prisma.favorite.deleteMany({ where: { userId, mediaAssetId: id } });
    }
    return { favorite: on };
  }
}
