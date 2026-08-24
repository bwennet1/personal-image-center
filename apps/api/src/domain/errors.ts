export class BusinessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

export const MESSAGES: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: "邮箱或密码不正确",
  AUTH_EMAIL_TAKEN: "该邮箱已被注册",
  AUTH_REQUIRED: "请先登录",
  AUTH_EMAIL_NOT_VERIFIED: "邮箱尚未验证",
  AUTH_OAUTH_NOT_CONFIGURED: "该第三方登录未配置",
  AUTH_MAGIC_LINK_INVALID: "登录链接无效或已过期",
  AUTH_RATE_LIMITED: "尝试过于频繁，请稍后再试",
  SPACE_ACCESS_DENIED: "没有权限执行此操作",
  SPACE_NOT_FOUND: "空间不存在",
  SPACE_QUOTA_EXCEEDED: "空间存储配额不足",
  SPACE_LAST_OWNER: "不能移除最后一位拥有者",
  MEDIA_NOT_FOUND: "图片不存在",
  MEDIA_NOT_READY: "图片尚未处理完成",
  MEDIA_ORIGINAL_NOT_AVAILABLE: "原图不可用",
  UPLOAD_SESSION_EXPIRED: "上传会话已过期",
  UPLOAD_CHECKSUM_MISMATCH: "文件校验不匹配",
  UPLOAD_UNSUPPORTED_FORMAT: "不支持的图片格式",
  UPLOAD_FILE_TOO_LARGE: "文件超过大小限制",
  SHARE_NOT_FOUND: "分享不存在",
  SHARE_EXPIRED: "分享已过期",
  SHARE_REVOKED: "分享已撤销",
  SHARE_PASSWORD_REQUIRED: "需要分享密码",
  SHARE_PASSWORD_INVALID: "分享密码不正确",
  SHARE_LOGIN_REQUIRED: "需要登录后查看",
  SHARE_MAX_VIEWS: "分享已达到最大查看次数",
  SHARE_TARGET_GONE: "分享内容已不可用",
  SHARE_DOWNLOAD_NOT_ALLOWED: "不允许下载",
  JOB_NOT_FOUND: "任务不存在",
  AI_PROVIDER_UNAVAILABLE: "AI 服务未配置",
  STORAGE_PROVIDER_UNAVAILABLE: "存储服务不可用",
  VALIDATION_ERROR: "请求参数无效",
};

export function fail(code: string, status?: number): never {
  throw new BusinessError(code, MESSAGES[code] || code, status ?? statusOf(code));
}

function statusOf(code: string): number {
  if (
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID_CREDENTIALS" ||
    code === "SHARE_PASSWORD_REQUIRED" ||
    code === "SHARE_LOGIN_REQUIRED"
  ) {
    return 401;
  }
  if (code === "SPACE_ACCESS_DENIED" || code === "SHARE_DOWNLOAD_NOT_ALLOWED") return 403;
  if (
    code.endsWith("_NOT_FOUND") ||
    code === "SHARE_NOT_FOUND" ||
    code === "MEDIA_NOT_FOUND" ||
    code === "SPACE_NOT_FOUND" ||
    code === "JOB_NOT_FOUND"
  ) {
    return 404;
  }
  if (code === "AUTH_RATE_LIMITED") return 429;
  return 400;
}
