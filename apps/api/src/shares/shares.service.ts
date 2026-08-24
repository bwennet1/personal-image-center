import { Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { MediaStatus, ShareAccessMode, ShareTargetType } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AccessService } from "../spaces/access.service";
import { fail } from "../domain/errors";
import { decideShareAccess, ShareAccessResult } from "../domain/share-access";
import { randomToken, sha256 } from "../domain/tokens";
import { StorageService } from "../storage/storage.service";
import { VersionType } from "@prisma/client";
import { collectMediaAssetIdsFromBlocks } from "../domain/presentations";

const SHARE_COOKIE_PREFIX = "pic_share_";

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly storage: StorageService,
  ) {}

  cookieName(token: string): string {
    return SHARE_COOKIE_PREFIX + token.slice(0, 12);
  }

  async create(
    userId: string,
    spaceId: string,
    input: {
      targetType?: string;
      targetId?: string;
      accessMode?: string;
      password?: string;
      expiresAt?: string;
      maxViews?: number;
      allowDownloadOptimized?: boolean;
      allowDownloadOriginal?: boolean;
      showExif?: boolean;
      showGps?: boolean;
    },
  ) {
    await this.access.require(userId, spaceId, "create_share");
    const targetType = (input.targetType || "MEDIA").toUpperCase() as ShareTargetType;
    if (!["MEDIA", "ALBUM", "SLIDESHOW", "PRESENTATION"].includes(targetType)) fail("VALIDATION_ERROR");
    if (!input.targetId) fail("VALIDATION_ERROR");
    await this.assertTarget(spaceId, targetType, input.targetId);
    const accessMode = (input.accessMode || "PUBLIC").toUpperCase() as ShareAccessMode;
    let passwordHash: string | null = null;
    if (accessMode === "PASSWORD") {
      if (!input.password) fail("VALIDATION_ERROR");
      passwordHash = await bcrypt.hash(input.password, 10);
    }
    const token = randomToken(18);
    const share = await this.prisma.shareLink.create({
      data: {
        spaceId,
        token,
        targetType,
        targetId: input.targetId,
        accessMode,
        passwordHash,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        maxViews: input.maxViews ?? null,
        allowDownloadOptimized: input.allowDownloadOptimized ?? true,
        allowDownloadOriginal: input.allowDownloadOriginal ?? false,
        showExif: input.showExif ?? false,
        showGps: input.showGps ?? false,
      },
    });
    await this.prisma.auditLog.create({
      data: { spaceId, actorId: userId, action: "share.create", target: share.id },
    });
    return {
      id: share.id,
      token: share.token,
      path: `/s/${share.token}`,
      accessMode: share.accessMode,
      targetType: share.targetType,
      targetId: share.targetId,
    };
  }

  async revoke(userId: string, spaceId: string, shareId: string) {
    await this.access.require(userId, spaceId, "create_share");
    await this.prisma.shareLink.updateMany({
      where: { id: shareId, spaceId },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async list(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    return this.prisma.shareLink.findMany({
      where: { spaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        targetType: true,
        targetId: true,
        accessMode: true,
        expiresAt: true,
        revokedAt: true,
        viewCount: true,
      },
    });
  }

  async assertTarget(spaceId: string, type: ShareTargetType, id: string): Promise<boolean> {
    if (type === "MEDIA") {
      const m = await this.prisma.mediaAsset.findFirst({ where: { id, spaceId } });
      return Boolean(m && m.status !== MediaStatus.TRASHED && m.status !== MediaStatus.PURGED && m.status !== MediaStatus.PURGING);
    }
    if (type === "ALBUM") return Boolean(await this.prisma.album.findFirst({ where: { id, spaceId } }));
    if (type === "SLIDESHOW") return Boolean(await this.prisma.slideshow.findFirst({ where: { id, spaceId } }));
    if (type === "PRESENTATION") return Boolean(await this.prisma.presentation.findFirst({ where: { id, spaceId } }));
    return false;
  }

  async evaluate(
    token: string,
    viewer: { userId?: string | null; passwordVerified: boolean },
  ): Promise<{ result: ShareAccessResult; share: { id: string; spaceId: string; targetType: ShareTargetType; targetId: string } }> {
    const share = await this.prisma.shareLink.findUnique({ where: { token } });
    const targetAlive = share ? await this.assertTarget(share.spaceId, share.targetType, share.targetId) : false;
    const result = decideShareAccess({
      share: share
        ? {
            revokedAt: share.revokedAt,
            expiresAt: share.expiresAt,
            maxViews: share.maxViews,
            viewCount: share.viewCount,
            accessMode: share.accessMode,
            passwordHash: share.passwordHash,
            allowDownloadOptimized: share.allowDownloadOptimized,
            allowDownloadOriginal: share.allowDownloadOriginal,
            showExif: share.showExif,
            showGps: share.showGps,
          }
        : null,
      targetAlive,
      now: new Date(),
      viewer,
    });
    if (!share) return { result, share: { id: "", spaceId: "", targetType: "MEDIA", targetId: "" } };
    return {
      result,
      share: { id: share.id, spaceId: share.spaceId, targetType: share.targetType, targetId: share.targetId },
    };
  }

  async verifyPassword(token: string, password: string) {
    const share = await this.prisma.shareLink.findUnique({ where: { token } });
    const targetAlive = share ? await this.assertTarget(share.spaceId, share.targetType, share.targetId) : false;
    const pre = decideShareAccess({
      share: share
        ? {
            revokedAt: share.revokedAt,
            expiresAt: share.expiresAt,
            maxViews: share.maxViews,
            viewCount: share.viewCount,
            accessMode: share.accessMode,
            passwordHash: share.passwordHash,
            allowDownloadOptimized: share.allowDownloadOptimized,
            allowDownloadOriginal: share.allowDownloadOriginal,
            showExif: share.showExif,
            showGps: share.showGps,
          }
        : null,
      targetAlive,
      now: new Date(),
      viewer: { passwordVerified: false },
    });
    if (pre.code === "SHARE_NOT_FOUND") fail("SHARE_NOT_FOUND");
    if (pre.code === "SHARE_REVOKED") fail("SHARE_REVOKED");
    if (pre.code === "SHARE_EXPIRED") fail("SHARE_EXPIRED");
    if (pre.code === "SHARE_TARGET_GONE") fail("SHARE_TARGET_GONE");
    if (pre.code === "SHARE_MAX_VIEWS") fail("SHARE_MAX_VIEWS");
    if (!share || share.accessMode !== "PASSWORD" || !share.passwordHash) fail("SHARE_PASSWORD_INVALID");
    const ok = await bcrypt.compare(password || "", share.passwordHash);
    if (!ok) fail("SHARE_PASSWORD_INVALID");
    const raw = randomToken(24);
    await this.prisma.shareSession.create({
      data: {
        shareLinkId: share.id,
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + 12 * 3600 * 1000),
      },
    });
    return { raw, cookieName: this.cookieName(token) };
  }

  async sessionValid(token: string, rawSession: string | null): Promise<boolean> {
    if (!rawSession) return false;
    const share = await this.prisma.shareLink.findUnique({ where: { token } });
    if (!share) return false;
    const row = await this.prisma.shareSession.findUnique({ where: { tokenHash: sha256(rawSession) } });
    if (!row || row.shareLinkId !== share.id) return false;
    return row.expiresAt.getTime() > Date.now();
  }

  async payload(token: string, viewer: { userId?: string | null; passwordVerified: boolean }) {
    const { result, share } = await this.evaluate(token, viewer);
    if (!result.ok) {
      fail(result.code, result.code === "SHARE_PASSWORD_REQUIRED" ? 401 : undefined);
    }
    await this.prisma.shareLink.update({
      where: { id: share.id },
      data: { viewCount: { increment: 1 } },
    });
    const base = { access: result, targetType: share.targetType, targetId: share.targetId };
    if (share.targetType === "MEDIA") {
      const media = await this.prisma.mediaAsset.findFirst({
        where: { id: share.targetId, spaceId: share.spaceId },
        include: { versions: true },
      });
      return {
        ...base,
        media: media
          ? {
              id: media.id,
              width: media.width,
              height: media.height,
              capturedAt: result.flags.showExif ? media.capturedAt : null,
              latitude: result.flags.showGps ? media.latitude : null,
              longitude: result.flags.showGps ? media.longitude : null,
              thumbnailUrl: `/public/shares/${token}/file?v=thumbnail`,
              optimizedUrl: `/public/shares/${token}/file?v=optimized`,
            }
          : null,
      };
    }
    if (share.targetType === "SLIDESHOW") {
      const show = await this.prisma.slideshow.findFirst({
        where: { id: share.targetId, spaceId: share.spaceId },
        include: { items: { orderBy: { sortOrder: "asc" }, include: { media: true } } },
      });
      return {
        ...base,
        slideshow: show
          ? {
              id: show.id,
              title: show.title,
              stayDurationMs: show.stayDurationMs,
              transition: show.transition,
              background: show.background,
              loop: show.loop,
              random: show.random,
              captions: show.captions,
              showDate: show.showDate,
              showLocation: show.showLocation,
              musicUrl: show.musicUrl,
              items: show.items.map((i) => ({
                assetId: i.media.id,
                failed: i.media.status === "PROCESSING_FAILED" || i.media.status === "TRASHED",
                url: `/public/shares/${token}/file/${i.media.id}?v=optimized`,
              })),
            }
          : null,
      };
    }
    if (share.targetType === "ALBUM") {
      const album = await this.prisma.album.findFirst({
        where: { id: share.targetId, spaceId: share.spaceId },
        include: { items: { include: { media: true }, orderBy: { sortOrder: "asc" } } },
      });
      return {
        ...base,
        album: album
          ? {
              id: album.id,
              name: album.name,
              items: album.items
                .filter((i) => i.media.status !== "TRASHED")
                .map((i) => ({
                  id: i.media.id,
                  thumbnailUrl: `/public/shares/${token}/file/${i.media.id}?v=thumbnail`,
                })),
            }
          : null,
      };
    }
    const presentation = await this.prisma.presentation.findFirst({
      where: { id: share.targetId, spaceId: share.spaceId },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });
    const referencedMediaAssetIds = presentation
      ? collectMediaAssetIdsFromBlocks(presentation.blocks)
      : [];
    if (presentation?.coverAssetId && !referencedMediaAssetIds.includes(presentation.coverAssetId)) {
      referencedMediaAssetIds.push(presentation.coverAssetId);
    }
    return {
      ...base,
      presentation: presentation
        ? {
            id: presentation.id,
            title: presentation.title,
            description: presentation.description,
            theme: presentation.theme,
            coverAssetId: presentation.coverAssetId,
            blocks: presentation.blocks.map((b) => ({
              id: b.id,
              type: b.type,
              sortOrder: b.sortOrder,
              data: b.data,
            })),
            referencedMediaAssetIds,
          }
        : null,
    };
  }

  async allowedShareMediaIds(share: {
    spaceId: string;
    targetType: ShareTargetType;
    targetId: string;
  }): Promise<Set<string>> {
    if (share.targetType === "MEDIA") return new Set([share.targetId]);
    if (share.targetType === "ALBUM") {
      const items = await this.prisma.albumItem.findMany({
        where: { albumId: share.targetId, media: { spaceId: share.spaceId } },
        select: { mediaAssetId: true },
      });
      return new Set(items.map((i) => i.mediaAssetId));
    }
    if (share.targetType === "SLIDESHOW") {
      const items = await this.prisma.slideshowItem.findMany({
        where: { slideshowId: share.targetId, media: { spaceId: share.spaceId } },
        select: { mediaAssetId: true },
      });
      return new Set(items.map((i) => i.mediaAssetId));
    }
    const presentation = await this.prisma.presentation.findFirst({
      where: { id: share.targetId, spaceId: share.spaceId },
      include: { blocks: true },
    });
    const ids = new Set(collectMediaAssetIdsFromBlocks(presentation?.blocks || []));
    if (presentation?.coverAssetId) ids.add(presentation.coverAssetId);
    return ids;
  }

  async shareFile(token: string, mediaId: string | undefined, variant: string, viewer: { userId?: string | null; passwordVerified: boolean }) {
    const { result, share } = await this.evaluate(token, viewer);
    if (!result.ok) fail(result.code);
    const allowed = await this.allowedShareMediaIds(share);
    const id = mediaId || (share.targetType === "MEDIA" ? share.targetId : undefined);
    if (!id || !allowed.has(id)) fail("MEDIA_NOT_FOUND");
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id, spaceId: share.spaceId },
      include: { versions: true },
    });
    if (!asset) fail("MEDIA_NOT_FOUND");
    const pick = (t: VersionType) => asset.versions.find((v) => v.versionType === t);
    let version = pick(VersionType.THUMBNAIL);
    if (variant === "original") {
      if (!result.flags.downloadOriginal) fail("SHARE_DOWNLOAD_NOT_ALLOWED");
      version = pick(VersionType.ORIGINAL);
    } else if (variant === "optimized") {
      version = pick(VersionType.OPTIMIZED_2560) || pick(VersionType.OPTIMIZED_1280) || pick(VersionType.THUMBNAIL);
    }
    if (!version) fail("MEDIA_NOT_FOUND");
    const buf = await this.storage.getObject(version.objectKey);
    return { buf, mime: version.mimeType };
  }
}
