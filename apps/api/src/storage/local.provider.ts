import { createHmac, timingSafeEqual } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { HeadResult, StorageAdapter, UploadSessionCredentials } from "./types";

function safeKey(objectKey: string): string {
  if (!objectKey || objectKey.includes("..") || path.isAbsolute(objectKey)) {
    throw new Error("invalid object key");
  }
  return objectKey;
}

export class LocalStorageProvider implements StorageAdapter {
  readonly providerName = "local";

  constructor(
    private readonly root: string,
    private readonly publicApiUrl: string,
    private readonly signingSecret: string,
  ) {}

  private fullPath(objectKey: string): string {
    return path.join(this.root, safeKey(objectKey));
  }

  async createUploadSession(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds: number;
    sessionId: string;
  }): Promise<UploadSessionCredentials> {
    const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
    return {
      provider: this.providerName,
      method: "PUT",
      uploadUrl: `${this.publicApiUrl}/uploads/${input.sessionId}/object`,
      headers: { "Content-Type": input.mimeType },
      objectKey: input.objectKey,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async putObject(objectKey: string, body: Buffer, _contentType: string): Promise<void> {
    const dest = this.fullPath(objectKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, body);
  }

  async getObject(objectKey: string): Promise<Buffer> {
    return fs.readFile(this.fullPath(objectKey));
  }

  async headObject(objectKey: string): Promise<HeadResult> {
    try {
      const st = await fs.stat(this.fullPath(objectKey));
      return { exists: true, size: st.size };
    } catch {
      return { exists: false };
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await fs.unlink(this.fullPath(objectKey));
    } catch {
      // already gone
    }
  }

  async copyObject(fromKey: string, toKey: string): Promise<void> {
    const dest = this.fullPath(toKey);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(this.fullPath(fromKey), dest);
  }

  async getSignedReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = this.sign(objectKey, exp);
    const q = new URLSearchParams({ key: objectKey, exp: String(exp), sig });
    return `${this.publicApiUrl}/storage/read?${q.toString()}`;
  }

  sign(objectKey: string, exp: number): string {
    return createHmac("sha256", this.signingSecret).update(`${objectKey}:${exp}`).digest("hex");
  }

  verify(objectKey: string, exp: number, sig: string): boolean {
    if (Math.floor(Date.now() / 1000) > exp) return false;
    const expected = this.sign(objectKey, exp);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
