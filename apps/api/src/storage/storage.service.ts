import { Injectable } from "@nestjs/common";
import * as path from "path";
import { HeadResult, StorageAdapter, UploadSessionCredentials } from "./types";
import { LocalStorageProvider } from "./local.provider";
import { hasR2Credentials, R2StorageProvider } from "./r2.provider";

export function resolveStorageProviderName(): string {
  if (process.env.STORAGE_PROVIDER) return process.env.STORAGE_PROVIDER;
  if (hasR2Credentials()) return "r2";
  return "local";
}

function buildAdapter(): StorageAdapter {
  const name = resolveStorageProviderName();
  const publicApiUrl = process.env.API_PUBLIC_URL || "http://127.0.0.1:3001";
  const secret = process.env.STORAGE_SIGNING_SECRET || process.env.SESSION_SECRET || "pic-dev-secret";
  if (name === "r2") {
    if (!hasR2Credentials()) {
      throw new Error("R2 selected but credentials are missing");
    }
    return new R2StorageProvider({
      accountId: process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "",
      accessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || "",
      bucket: process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET || "",
      endpoint: process.env.R2_ENDPOINT || process.env.S3_ENDPOINT,
      region: process.env.R2_REGION || process.env.AWS_REGION,
    });
  }
  const root = process.env.STORAGE_LOCAL_ROOT || path.join(process.cwd(), "data", "storage");
  return new LocalStorageProvider(root, publicApiUrl, secret);
}

@Injectable()
export class StorageService implements StorageAdapter {
  private readonly impl: StorageAdapter = buildAdapter();

  get providerName(): string {
    return this.impl.providerName;
  }

  get local(): LocalStorageProvider | null {
    return this.impl instanceof LocalStorageProvider ? this.impl : null;
  }

  createUploadSession(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds: number;
    sessionId: string;
  }): Promise<UploadSessionCredentials> {
    return this.impl.createUploadSession(input);
  }

  putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    return this.impl.putObject(objectKey, body, contentType);
  }

  getObject(objectKey: string): Promise<Buffer> {
    return this.impl.getObject(objectKey);
  }

  headObject(objectKey: string): Promise<HeadResult> {
    return this.impl.headObject(objectKey);
  }

  deleteObject(objectKey: string): Promise<void> {
    return this.impl.deleteObject(objectKey);
  }

  copyObject(fromKey: string, toKey: string): Promise<void> {
    return this.impl.copyObject(fromKey, toKey);
  }

  getSignedReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return this.impl.getSignedReadUrl(objectKey, expiresInSeconds);
  }
}
