export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export function declaredMimeFromName(filename: string, declared?: string): string {
  if (declared && declared !== "application/octet-stream") return declared.toLowerCase();
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "avif") return "image/avif";
  if (ext === "gif") return "image/gif";
  return declared || "application/octet-stream";
}

/** Content-based MIME. Extension is never sufficient. */
export function detectImageMime(buf: Buffer): AllowedImageMime | null {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    const compat = buf.toString("ascii", 8, Math.min(buf.length, 32));
    if (brand === "avif" || brand === "avis" || compat.includes("avif")) return "image/avif";
  }
  return null;
}

export function isAllowedImageMime(mime: string | null): mime is AllowedImageMime {
  return !!mime && (ALLOWED_IMAGE_MIMES as readonly string[]).includes(mime);
}
