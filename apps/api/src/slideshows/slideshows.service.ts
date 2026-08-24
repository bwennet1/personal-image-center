import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { AccessService } from "../spaces/access.service";
import { fail } from "../domain/errors";
import {
  DEFAULT_SLIDESHOW,
  isSlideshowTransition,
  nextPlayableIndex,
  playableItems,
} from "../domain/slideshow-player";

@Injectable()
export class SlideshowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    return this.prisma.slideshow.findMany({
      where: { spaceId },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(
    userId: string,
    spaceId: string,
    input: {
      title?: string;
      albumId?: string;
      mediaAssetIds?: string[];
      stayDurationMs?: number;
      transition?: string;
      background?: string;
      loop?: boolean;
      random?: boolean;
      captions?: boolean;
      showDate?: boolean;
      showLocation?: boolean;
      musicUrl?: string;
    },
  ) {
    await this.access.require(userId, spaceId, "create_slideshow");
    const transition =
      input.transition && isSlideshowTransition(input.transition)
        ? input.transition
        : DEFAULT_SLIDESHOW.transition;
    const show = await this.prisma.slideshow.create({
      data: {
        spaceId,
        albumId: input.albumId || null,
        title: input.title?.trim() || "未命名幻灯片",
        stayDurationMs: input.stayDurationMs ?? DEFAULT_SLIDESHOW.stayDurationMs,
        transition,
        background: input.background || DEFAULT_SLIDESHOW.background,
        loop: input.loop ?? DEFAULT_SLIDESHOW.loop,
        random: input.random ?? DEFAULT_SLIDESHOW.random,
        captions: input.captions ?? DEFAULT_SLIDESHOW.captions,
        showDate: input.showDate ?? DEFAULT_SLIDESHOW.showDate,
        showLocation: input.showLocation ?? DEFAULT_SLIDESHOW.showLocation,
        musicUrl: input.musicUrl,
      },
    });
    let ids = input.mediaAssetIds || [];
    if (input.albumId && ids.length === 0) {
      const items = await this.prisma.albumItem.findMany({
        where: { albumId: input.albumId },
        orderBy: { sortOrder: "asc" },
      });
      ids = items.map((i) => i.mediaAssetId);
    }
    await this.replaceItems(spaceId, show.id, ids);
    return this.get(userId, spaceId, show.id);
  }

  async replaceItems(spaceId: string, slideshowId: string, mediaAssetIds: string[]) {
    const unique = [...new Set(mediaAssetIds)];
    const assets = await this.prisma.mediaAsset.findMany({
      where: { spaceId, id: { in: unique } },
      select: { id: true },
    });
    const orderMap = new Map(unique.map((id, i) => [id, i]));
    await this.prisma.slideshowItem.deleteMany({ where: { slideshowId } });
    await this.prisma.slideshowItem.createMany({
      data: assets.map((a) => ({
        slideshowId,
        mediaAssetId: a.id,
        sortOrder: orderMap.get(a.id) ?? 0,
      })),
    });
  }

  async get(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "view_media");
    const show = await this.prisma.slideshow.findFirst({
      where: { id, spaceId },
      include: { items: { orderBy: { sortOrder: "asc" }, include: { media: true } } },
    });
    if (!show) fail("MEDIA_NOT_FOUND");
    const items = show.items.map((i) => ({
      assetId: i.media.id,
      failed:
        i.media.status === "PROCESSING_FAILED" ||
        i.media.status === "TRASHED" ||
        i.media.status === "PURGED",
      status: i.media.status,
      width: i.media.width,
      height: i.media.height,
      capturedAt: i.media.capturedAt,
      locationText: i.media.locationText,
      url: `/spaces/${spaceId}/media/${i.media.id}/file?v=optimized_2560`,
    }));
    const playable = playableItems(items);
    return {
      id: show.id,
      title: show.title,
      stayDurationMs: show.stayDurationMs,
      transition: show.transition,
      transitionMs: show.transitionMs,
      background: show.background,
      loop: show.loop,
      random: show.random,
      captions: show.captions,
      showDate: show.showDate,
      showLocation: show.showLocation,
      musicUrl: show.musicUrl,
      items,
      playableCount: playable.length,
    };
  }

  step(items: { assetId: string; failed?: boolean }[], from: number, direction: 1 | -1) {
    return nextPlayableIndex(items, from, direction);
  }
}
