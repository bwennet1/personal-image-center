import { createHash } from "crypto";
import { MediaStatus, VersionType } from "@prisma/client";
import sharp from "sharp";
import exifr from "exifr";
import { PrismaService } from "../prisma.service";
import { StorageAdapter } from "../storage/types";
import { detectImageMime, isAllowedImageMime } from "../domain/mime";

export interface ProcessDeps {
  prisma: PrismaService;
  storage: StorageAdapter;
}

async function perceptualHash(buf: Buffer): Promise<string> {
  const raw = await sharp(buf).greyscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
  let sum = 0;
  for (const v of raw) sum += v;
  const mean = sum / raw.length;
  let bits = "";
  for (const v of raw) bits += v >= mean ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

async function writeVersion(
  deps: ProcessDeps,
  assetId: string,
  type: VersionType,
  objectKey: string,
  buf: Buffer,
  mime: string,
  width: number,
  height: number,
): Promise<{ created: boolean; bytes: number }> {
  const existing = await deps.prisma.mediaVersion.findUnique({
    where: { mediaAssetId_versionType: { mediaAssetId: assetId, versionType: type } },
  });
  if (existing) return { created: false, bytes: 0 };
  await deps.storage.putObject(objectKey, buf, mime);
  const checksum = createHash("sha256").update(buf).digest("hex");
  try {
    await deps.prisma.mediaVersion.create({
      data: {
        mediaAssetId: assetId,
        versionType: type,
        storageProvider: deps.storage.providerName,
        objectKey,
        mimeType: mime,
        width,
        height,
        bytes: BigInt(buf.length),
        checksum,
      },
    });
    return { created: true, bytes: buf.length };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") return { created: false, bytes: 0 };
    throw err;
  }
}

async function derivative(
  buf: Buffer,
  maxEdge: number,
): Promise<{ buf: Buffer; width: number; height: number; mime: string }> {
  const img = sharp(buf, { failOn: "error", animated: false }).rotate();
  const meta = await img.metadata();
  const w = meta.width || maxEdge;
  const h = meta.height || maxEdge;
  const needsResize = Math.max(w, h) > maxEdge;
  const pipeline = needsResize
    ? img.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
    : img;
  const out = await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const outMeta = await sharp(out).metadata();
  return {
    buf: out,
    width: outMeta.width || w,
    height: outMeta.height || h,
    mime: "image/jpeg",
  };
}

/**
 * The same handler BullMQ workers and in-process tests invoke.
 * Idempotent: existing version_types are not duplicated.
 */
export async function processImageJob(deps: ProcessDeps, assetId: string): Promise<void> {
  const asset = await deps.prisma.mediaAsset.findUnique({
    where: { id: assetId },
    include: { versions: true },
  });
  if (!asset) return;
  if (asset.status === MediaStatus.TRASHED || asset.status === MediaStatus.PURGING) return;

  const original = asset.versions.find((v) => v.versionType === VersionType.ORIGINAL);
  if (!original) {
    await deps.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: MediaStatus.PROCESSING_FAILED, failureReason: "MEDIA_ORIGINAL_NOT_AVAILABLE" },
    });
    return;
  }

  await deps.prisma.mediaAsset.update({
    where: { id: assetId },
    data: { status: MediaStatus.PROCESSING },
  });

  let buf: Buffer;
  try {
    buf = await deps.storage.getObject(original.objectKey);
  } catch {
    await deps.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: MediaStatus.PROCESSING_FAILED, failureReason: "STORAGE_PROVIDER_UNAVAILABLE" },
    });
    return;
  }

  const mime = detectImageMime(buf);
  if (!isAllowedImageMime(mime)) {
    await deps.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: MediaStatus.PROCESSING_FAILED, failureReason: "UPLOAD_UNSUPPORTED_FORMAT" },
    });
    return;
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf, { failOn: "error", animated: false }).rotate().metadata();
    if (!meta.width || !meta.height) throw new Error("undecodable");
  } catch {
    await deps.prisma.mediaAsset.update({
      where: { id: assetId },
      data: { status: MediaStatus.PROCESSING_FAILED, failureReason: "UPLOAD_UNSUPPORTED_FORMAT" },
    });
    return;
  }

  const fileHash = createHash("sha256").update(buf).digest("hex");
  let pHash: string | null = null;
  try {
    pHash = await perceptualHash(buf);
  } catch {
    pHash = null;
  }

  let capturedAt: Date | null = asset.capturedAt;
  let latitude: number | null = asset.latitude;
  let longitude: number | null = asset.longitude;
  let exifSummary: Record<string, unknown> | null = null;
  try {
    const exif = (await exifr.parse(buf, { gps: true })) as Record<string, unknown> | undefined;
    if (exif) {
      const dt = (exif.DateTimeOriginal || exif.CreateDate) as Date | string | undefined;
      if (dt && !capturedAt) capturedAt = dt instanceof Date ? dt : new Date(dt);
      if (typeof exif.latitude === "number") latitude = exif.latitude;
      if (typeof exif.longitude === "number") longitude = exif.longitude;
      exifSummary = {
        make: exif.Make,
        model: exif.Model,
        orientation: exif.Orientation,
      };
    }
  } catch {
    // EXIF is optional
  }

  const width = meta.width || 0;
  const height = meta.height || 0;

  const failures: string[] = [];
  let newOptBytes = 0;
  try {
    const thumb = await derivative(buf, 400);
    const wrote = await writeVersion(
      deps,
      assetId,
      VersionType.THUMBNAIL,
      `spaces/${asset.spaceId}/media/${assetId}/thumb/${fileHash.slice(0, 16)}.jpg`,
      thumb.buf,
      thumb.mime,
      thumb.width,
      thumb.height,
    );
    if (wrote.created) newOptBytes += wrote.bytes;
  } catch {
    failures.push("thumbnail");
  }
  try {
    const v1280 = await derivative(buf, 1280);
    const wrote = await writeVersion(
      deps,
      assetId,
      VersionType.OPTIMIZED_1280,
      `spaces/${asset.spaceId}/media/${assetId}/v/1280/${fileHash.slice(0, 16)}.jpg`,
      v1280.buf,
      v1280.mime,
      v1280.width,
      v1280.height,
    );
    if (wrote.created) newOptBytes += wrote.bytes;
  } catch {
    failures.push("optimized_1280");
  }
  try {
    const v2560 = await derivative(buf, 2560);
    const wrote = await writeVersion(
      deps,
      assetId,
      VersionType.OPTIMIZED_2560,
      `spaces/${asset.spaceId}/media/${assetId}/v/2560/${fileHash.slice(0, 16)}.jpg`,
      v2560.buf,
      v2560.mime,
      v2560.width,
      v2560.height,
    );
    if (wrote.created) newOptBytes += wrote.bytes;
  } catch {
    failures.push("optimized_2560");
  }

  const versions = await deps.prisma.mediaVersion.findMany({ where: { mediaAssetId: assetId } });
  const hasThumb = versions.some((v) => v.versionType === VersionType.THUMBNAIL);
  const has1280 = versions.some((v) => v.versionType === VersionType.OPTIMIZED_1280);
  const has2560 = versions.some((v) => v.versionType === VersionType.OPTIMIZED_2560);

  let status: MediaStatus = MediaStatus.READY;
  let failureReason: string | null = null;
  if (!hasThumb) {
    status = MediaStatus.PROCESSING_FAILED;
    failureReason = "UPLOAD_UNSUPPORTED_FORMAT";
  } else if (!has1280 || !has2560 || failures.length) {
    status = MediaStatus.PARTIAL_READY;
    failureReason = failures.join(",") || null;
  }

  await deps.prisma.mediaAsset.update({
    where: { id: assetId },
    data: {
      mimeType: mime,
      width,
      height,
      aspectRatio: height ? width / height : null,
      fileHash,
      perceptualHash: pHash,
      capturedAt: capturedAt || asset.uploadedAt,
      latitude,
      longitude,
      exifSummary: exifSummary as object | undefined,
      status,
      failureReason,
      currentDisplay: hasThumb ? VersionType.THUMBNAIL : asset.currentDisplay,
    },
  });

  if (newOptBytes) {
    await deps.prisma.space.update({
      where: { id: asset.spaceId },
      data: { usedOptimizedBytes: { increment: BigInt(newOptBytes) } },
    });
  }
}
