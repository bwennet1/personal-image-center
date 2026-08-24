export type ShareAccessMode = "PUBLIC" | "PASSWORD" | "LOGIN_REQUIRED";

export interface ShareSnapshot {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxViews: number | null;
  viewCount: number;
  accessMode: ShareAccessMode;
  passwordHash: string | null;
  allowDownloadOptimized: boolean;
  allowDownloadOriginal: boolean;
  showExif: boolean;
  showGps: boolean;
  allowedUserIds?: string[] | null;
}

export interface ShareViewer {
  userId?: string | null;
  passwordVerified: boolean;
}

export interface ShareAccessInput {
  share: ShareSnapshot | null;
  targetAlive: boolean;
  now: Date;
  viewer: ShareViewer;
}

export interface ShareFlags {
  view: boolean;
  downloadOptimized: boolean;
  downloadOriginal: boolean;
  showExif: boolean;
  showGps: boolean;
}

export interface ShareAccessResult {
  ok: boolean;
  code: string;
  flags: ShareFlags;
}

const DENY_FLAGS: ShareFlags = {
  view: false,
  downloadOptimized: false,
  downloadOriginal: false,
  showExif: false,
  showGps: false,
};

/**
 * Appendix D decision order. Controllers MUST call this rather than
 * inventing per-route share checks.
 */
export function decideShareAccess(input: ShareAccessInput): ShareAccessResult {
  const deny = (code: string): ShareAccessResult => ({ ok: false, code, flags: DENY_FLAGS });

  if (!input.share) return deny("SHARE_NOT_FOUND");
  const s = input.share;

  if (s.revokedAt) return deny("SHARE_REVOKED");
  if (!input.targetAlive) return deny("SHARE_TARGET_GONE");
  if (s.expiresAt && input.now.getTime() > s.expiresAt.getTime()) return deny("SHARE_EXPIRED");
  if (s.maxViews != null && s.viewCount >= s.maxViews) return deny("SHARE_MAX_VIEWS");

  if (s.accessMode === "LOGIN_REQUIRED" && !input.viewer.userId) {
    return deny("SHARE_LOGIN_REQUIRED");
  }

  if (s.allowedUserIds && s.allowedUserIds.length > 0) {
    if (!input.viewer.userId || !s.allowedUserIds.includes(input.viewer.userId)) {
      return deny("SHARE_LOGIN_REQUIRED");
    }
  }

  if (s.accessMode === "PASSWORD") {
    if (!input.viewer.passwordVerified) return deny("SHARE_PASSWORD_REQUIRED");
  }

  return {
    ok: true,
    code: "SHARE_OK",
    flags: {
      view: true,
      downloadOptimized: s.allowDownloadOptimized,
      downloadOriginal: s.allowDownloadOriginal,
      showExif: s.showExif,
      showGps: s.showGps,
    },
  };
}
