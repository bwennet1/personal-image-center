import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { AccessService } from "../spaces/access.service";
import { fail } from "../domain/errors";
import {
  collectMediaAssetIdsFromBlocks,
  PRESENTATION_PRESETS,
  PresentationPresetKey,
} from "../domain/presentations";
import { randomToken } from "../domain/tokens";

@Injectable()
export class PresentationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async list(userId: string, spaceId: string) {
    await this.access.require(userId, spaceId, "view_media");
    return this.prisma.presentation.findMany({ where: { spaceId }, orderBy: { createdAt: "desc" } });
  }

  async create(
    userId: string,
    spaceId: string,
    input: {
      title?: string;
      preset?: string;
      mediaAssetIds?: string[];
      coverAssetId?: string;
      musicUrl?: string;
    },
  ) {
    await this.access.require(userId, spaceId, "create_presentation");
    const key = (input.preset || "family_memorial") as PresentationPresetKey;
    const preset = PRESENTATION_PRESETS[key] || PRESENTATION_PRESETS.family_memorial;
    const ids = input.mediaAssetIds || [];
    const presentation = await this.prisma.presentation.create({
      data: {
        spaceId,
        title: input.title?.trim() || preset.title,
        theme: preset.theme,
        preset: preset.preset,
        coverAssetId: input.coverAssetId || ids[0] || null,
        musicUrl: input.musicUrl,
      },
    });
    const blocks = preset.blocks.map((b, i) => {
      const data: Record<string, unknown> = { ...b.data };
      if (b.type === "gallery" || b.type === "timeline") data.mediaAssetIds = ids;
      if (b.type === "image") data.mediaAssetId = ids[0] || null;
      if (b.type === "cover") data.mediaAssetId = input.coverAssetId || ids[0] || null;
      return {
        presentationId: presentation.id,
        type: b.type,
        sortOrder: i,
        data: data as Prisma.InputJsonValue,
      };
    });
    await this.prisma.presentationBlock.createMany({ data: blocks });
    return this.get(userId, spaceId, presentation.id);
  }

  async get(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "view_media");
    const p = await this.prisma.presentation.findFirst({
      where: { id, spaceId },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });
    if (!p) fail("MEDIA_NOT_FOUND");
    return this.serialize(p);
  }

  async publish(userId: string, spaceId: string, id: string) {
    await this.access.require(userId, spaceId, "create_presentation");
    const p = await this.prisma.presentation.findFirst({ where: { id, spaceId } });
    if (!p) fail("MEDIA_NOT_FOUND");
    const token = p.publishToken || randomToken(18);
    const updated = await this.prisma.presentation.update({
      where: { id },
      data: { published: true, publishToken: token },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });
    await this.prisma.auditLog.create({
      data: { spaceId, actorId: userId, action: "presentation.publish", target: id },
    });
    return { ...this.serialize(updated), publishPath: `/p/${token}` };
  }

  async publicByToken(token: string) {
    const p = await this.prisma.presentation.findUnique({
      where: { publishToken: token },
      include: { blocks: { orderBy: { sortOrder: "asc" } } },
    });
    if (!p || !p.published) fail("MEDIA_NOT_FOUND");
    return this.serialize(p);
  }

  async publicFile(token: string, mediaId: string) {
    const p = await this.publicByToken(token);
    const allowed = new Set(p.referencedMediaAssetIds);
    if (p.coverAssetId) allowed.add(p.coverAssetId);
    if (!allowed.has(mediaId)) fail("MEDIA_NOT_FOUND");
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: mediaId, spaceId: p.spaceId },
      include: { versions: true },
    });
    if (!asset) fail("MEDIA_NOT_FOUND");
    const pick =
      asset.versions.find((v) => v.versionType === "OPTIMIZED_1280") ||
      asset.versions.find((v) => v.versionType === "THUMBNAIL") ||
      asset.versions.find((v) => v.versionType === "OPTIMIZED_2560");
    if (!pick) fail("MEDIA_NOT_READY");
    return pick;
  }

  serialize(p: {
    id: string;
    spaceId: string;
    title: string;
    description: string | null;
    coverAssetId: string | null;
    theme: string;
    background: Prisma.JsonValue | null;
    musicUrl: string | null;
    preset: string | null;
    published: boolean;
    publishToken: string | null;
    blocks: { id: string; type: string; sortOrder: number; data: Prisma.JsonValue }[];
  }) {
    const mediaAssetIds = collectMediaAssetIdsFromBlocks(p.blocks);
    return {
      id: p.id,
      spaceId: p.spaceId,
      title: p.title,
      description: p.description,
      coverAssetId: p.coverAssetId,
      theme: p.theme,
      background: p.background,
      musicUrl: p.musicUrl,
      preset: p.preset,
      published: p.published,
      publishToken: p.publishToken,
      blocks: p.blocks.map((b) => ({
        id: b.id,
        type: b.type,
        sortOrder: b.sortOrder,
        data: b.data,
      })),
      referencedMediaAssetIds: mediaAssetIds,
    };
  }
}
