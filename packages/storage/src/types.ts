export interface GcsStorageConfig {
  projectId?: string;
  bucketName: string;
  /** fake-gcs-server endpoint for dev/test, e.g. http://localhost:4443 */
  apiEndpoint?: string;
}

export interface S3StorageConfig {
  region: string;
  bucketName: string;
  /** MinIO/LocalStack endpoint for dev/test */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Provider is selected by config (STORAGE_PROVIDER env in each app). */
export interface StorageConfig {
  provider: 'gcs' | 's3';
  gcs?: GcsStorageConfig;
  s3?: S3StorageConfig;
}

export interface UploadOptions {
  filename: string;
  contentType: string;
  metadata?: Record<string, string>;
  scopeType?: string;
  scopeId?: string;
}

export interface UploadResult {
  filename: string;
  path: string;
  size: number;
}

export interface DeleteResult {
  filename: string;
  deleted: boolean;
}

export interface FileMetadata {
  name?: string;
  contentType?: string;
  size?: number | string;
  metadata?: Record<string, string>;
  lastModified?: Date;
}

export interface ListedFile {
  name: string;
  contentType?: string;
  size?: number;
  updated?: Date;
}

export interface UploadToPathOptions {
  path: string;
  contentType: string;
  metadata?: Record<string, string>;
  ifNotExists?: boolean;
  resumable?: boolean;
  /** GCS only: per-request timeout in ms (SDK default when omitted). */
  timeoutMs?: number;
  /** GCS only: resumable upload chunk size in bytes (multiple of 256 KiB). Bounds buffering and avoids
   *  single-request timeouts when the source stream is slow. No effect on S3 (already multipart). */
  chunkSize?: number;
}

export interface StorageService {
  uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;
  uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult>;
  uploadFileV2(buffer: Buffer, options: { path: string; contentType: string; cacheControl?: string; metadata?: Record<string, string>; ifNotExists?: boolean; timeoutMs?: number }): Promise<UploadResult>;
  uploadStreamToPath(stream: NodeJS.ReadableStream, options: UploadToPathOptions): Promise<UploadResult>;
  deleteFile(filename: string): Promise<DeleteResult>;
  generateSignedUrl(filename: string, expirationHours?: number): Promise<string>;
  fileExists(filename: string): Promise<boolean>;
  getFileMetadata(filename: string): Promise<FileMetadata>;
  getFileBuffer(path: string, maxRetries?: number): Promise<Buffer>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  createReadStream(path: string, options?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream>;
  listFiles(prefix: string): Promise<ListedFile[]>;
  moveFile(sourcePath: string, destinationPath: string): Promise<void>;
  ensureBucketExists(): Promise<void>;
  checkBucketExists(): Promise<void>;
  buildStorageUri(path: string): string;
}

export function isPreconditionFailed(err: unknown): boolean {
  const e = err as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    name?: unknown;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e?.code === 412 ||
    e?.status === 412 ||
    e?.statusCode === 412 ||
    e?.$metadata?.httpStatusCode === 412 ||
    e?.name === 'PreconditionFailed'
  );
}
