import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { HeadResult, StorageAdapter, UploadSessionCredentials } from "./types";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint?: string;
  region?: string;
}

export class R2StorageProvider implements StorageAdapter {
  readonly providerName = "r2";
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(cfg: R2Config) {
    const endpoint =
      cfg.endpoint || `https://${cfg.accountId}.r2.cloudflarestorage.com`;
    this.client = new S3Client({
      region: cfg.region || "auto",
      endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = cfg.bucket;
  }

  async createUploadSession(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds: number;
    sessionId: string;
  }): Promise<UploadSessionCredentials> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
    });
    return {
      provider: this.providerName,
      method: "PUT",
      uploadUrl,
      headers: { "Content-Type": input.mimeType },
      objectKey: input.objectKey,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
    };
  }

  async putObject(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getObject(objectKey: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    const bytes = await out.Body?.transformToByteArray();
    return Buffer.from(bytes || []);
  }

  async headObject(objectKey: string): Promise<HeadResult> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return {
        exists: true,
        size: out.ContentLength,
        contentType: out.ContentType,
      };
    } catch {
      return { exists: false };
    }
  }

  async deleteObject(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async copyObject(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${fromKey}`,
        Key: toKey,
      }),
    );
  }

  async getSignedReadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { expiresIn: expiresInSeconds },
    );
  }
}

export function hasR2Credentials(): boolean {
  return Boolean(
    (process.env.R2_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID) &&
      (process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID) &&
      (process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY) &&
      (process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET),
  );
}
