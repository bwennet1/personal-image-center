import { Injectable } from "@nestjs/common";
import { MediaStatus, UploadSessionStatus, VersionType } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { StorageService } from "../storage/storage.service";
import { AccessService } from "../spaces/access.service";
import { fail } from "../domain/errors";
import { detectImageMime, isAllowedImageMime, declaredMimeFromName } from "../domain/mime";
import { objectId } from "../domain/tokens";
import { enqueueImageProcess } from "../jobs/image.queue";
import { processImageJob } from "../media/media-processor";

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
  ) {}

  async createSession(
    userId: string,
    input: { spaceId: string; filename: string; mimeType?: string; bytes: number },
  ) {
    const member = await this.access.require(userId, input.spaceId, "upload_media");
    const filename = (input.filename || "image").slice(0, 255);
    const declaredMime = declaredMimeFromName(filename, input.mimeType);
    const bytes = Number(input.bytes || 0);
    if (bytes <= 0) fail("VALIDATION_ERROR");
    if (BigInt(bytes) > member.space.maxFileBytes) fail("UPLOAD_FILE_TOO_LARGE");
    const used = member.space.usedOriginalBytes + member.space.usedOptimizedBytes;
    if (used + BigInt(bytes) > member.space.quotaBytes) fail("SPACE_QUOTA_EXCEEDED");

    const sessionId = objectId();
    const objectKey = `spaces/${input.spaceId}/uploads/${sessionId}/${objectId()}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await this.prisma.uploadSession.create({
      data: {
        id: sessionId,
        spaceId: input.spaceId,
        userId,
        filename,
        declaredMime,
        declaredBytes: BigInt(bytes),
        objectKey,
        status: UploadSessionStatus.CREATED,
        expiresAt,
      },
    });
    const creds = await this.storage.createUploadSession({
      objectKey,
      mimeType: declaredMime,
      expiresInSeconds: 30 * 60,
      sessionId,
    });
    return {
      sessionId,
      ...creds,
      provider: this.storage.providerName,
    };
  }

  async putObject(sessionId: string, body: Buffer, userId?: string) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session) fail("MEDIA_NOT_FOUND");
    if (userId && session.userId !== userId) fail("SPACE_ACCESS_DENIED");
    if (session.expiresAt.getTime() < Date.now()) fail("UPLOAD_SESSION_EXPIRED");
    if (session.status === UploadSessionStatus.COMMITTED) fail("VALIDATION_ERROR");
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.UPLOADING },
    });
    await this.storage.putObject(session.objectKey, body, session.declaredMime);
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.UPLOADED },
    });
    return { ok: true, bytes: body.length };
  }

  async complete(sessionId: string, userId: string) {
    const session = await this.prisma.uploadSession.findUnique({ where: { id: sessionId } });
    if (!session) fail("MEDIA_NOT_FOUND");
    if (session.userId !== userId) fail("SPACE_ACCESS_DENIED");
    if (session.expiresAt.getTime() < Date.now() && session.status !== UploadSessionStatus.COMMITTED) {
      fail("UPLOAD_SESSION_EXPIRED");
    }
    if (session.status === UploadSessionStatus.COMMITTED && session.mediaAssetId) {
      const asset = await this.prisma.mediaAsset.findUnique({
        where: { id: session.mediaAssetId },
        include: { versions: true },
      });
      return { asset, alreadyCommitted: true };
    }

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.VERIFYING },
    });

    const head = await this.storage.headObject(session.objectKey);
    if (!head.exists) {
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.FAILED, failureReason: "object missing" },
      });
      fail("STORAGE_PROVIDER_UNAVAILABLE");
    }

    const buf = await this.storage.getObject(session.objectKey);
    const mime = detectImageMime(buf);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        spaceId: session.spaceId,
        uploaderId: userId,
        originalFilename: session.filename,
        mimeType: mime,
        status: MediaStatus.UPLOADED,
        capturedAt: new Date(),
      },
    });

    const finalKey = `spaces/${session.spaceId}/media/${asset.id}/original/${objectId()}`;
    await this.storage.copyObject(session.objectKey, finalKey);

    await this.prisma.mediaVersion.create({
      data: {
        mediaAssetId: asset.id,
        versionType: VersionType.ORIGINAL,
        storageProvider: this.storage.providerName,
        objectKey: finalKey,
        mimeType: mime || session.declaredMime,
        bytes: BigInt(buf.length),
      },
    });

    await this.prisma.space.update({
      where: { id: session.spaceId },
      data: { usedOriginalBytes: { increment: BigInt(buf.length) } },
    });

    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.COMMITTED, mediaAssetId: asset.id },
    });

    await this.prisma.jobRecord.create({
      data: { type: "image.process", spaceId: session.spaceId, targetId: asset.id, status: "PENDING" },
    });

    if (!isAllowedImageMime(mime)) {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaStatus.PROCESSING_FAILED, failureReason: "UPLOAD_UNSUPPORTED_FORMAT" },
      });
    } else {
      await this.prisma.mediaAsset.update({
        where: { id: asset.id },
        data: { status: MediaStatus.PROCESSING },
      });
      await enqueueImageProcess(asset.id, session.spaceId);
      if (process.env.JOBS_INLINE === "true") {
        await processImageJob({ prisma: this.prisma, storage: this.storage }, asset.id);
      }
    }

    const fresh = await this.prisma.mediaAsset.findUnique({
      where: { id: asset.id },
      include: { versions: true },
    });
    return {
      asset: fresh
        ? {
            ...fresh,
            versions: fresh.versions.map((v) => ({ ...v, bytes: Number(v.bytes) })),
          }
        : fresh,
      alreadyCommitted: false,
      provider: this.storage.providerName,
    };
  }
}
