export interface UploadSessionCredentials {
  provider: string;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string>;
  objectKey: string;
  expiresAt: string;
}

export interface HeadResult {
  exists: boolean;
  size?: number;
  contentType?: string;
}

export interface StorageAdapter {
  readonly providerName: string;
  createUploadSession(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds: number;
    sessionId: string;
  }): Promise<UploadSessionCredentials>;
  putObject(objectKey: string, body: Buffer, contentType: string): Promise<void>;
  getObject(objectKey: string): Promise<Buffer>;
  headObject(objectKey: string): Promise<HeadResult>;
  deleteObject(objectKey: string): Promise<void>;
  copyObject(fromKey: string, toKey: string): Promise<void>;
  getSignedReadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
}
