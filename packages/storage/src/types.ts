export interface GcsStorageConfig {
  projectId?: string;
  bucketName: string;
  /** fake-gcs-server endpoint for dev/test, e.g. http://localhost:4443 */
  apiEndpoint?: string;
}

export interface S3StorageConfig {
  region: string;
  bucketName: string;
  /** RustFS/MinIO/LocalStack endpoint for dev/test */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface AzureStorageConfig {
  accountName?: string;
  endpoint?: string;
  connectionString?: string;
  containerName: string;
  sasToken?: string;
  anonymous?: boolean;
}

/** Provider is selected by config (STORAGE_PROVIDER env in each app). */
export interface StorageConfig {
  provider: 'gcs' | 's3' | 'azure';
  gcs?: GcsStorageConfig;
  s3?: S3StorageConfig;
  azure?: AzureStorageConfig;
}

/**
 * GCS customer-supplied encryption key (CSEK) for one object. GCS keeps only the key's hash,
 * so every later read, copy or move of the object must present the same key.
 */
export interface ObjectEncryption {
  /** 32-byte AES-256 key. */
  key: Buffer;
  /** Written to the object's custom metadata, which stays readable without the key. */
  customMetadata: Record<string, string>;
}

/** Key for reading, copying or moving an object written with `ObjectEncryption`. */
export interface ObjectKeyOptions {
  encryptionKey?: Buffer;
}

export interface UploadOptions {
  filename: string;
  contentType: string;
  metadata?: Record<string, string>;
  scopeType?: string;
  scopeId?: string;
  encryption?: ObjectEncryption;
  /** When set, the file goes under workspaces/{workspaceId}/ instead of the bucket root. */
  workspaceId?: string;
}

export interface UploadV2Options {
  path: string;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  ifNotExists?: boolean;
  timeoutMs?: number;
  encryption?: ObjectEncryption;
}

export interface ReadStreamOptions extends ObjectKeyOptions {
  start?: number;
  end?: number;
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

/** Read-path metadata for one object, as returned by headObject / getObject. */
export interface ObjectInfo {
  size?: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
  /** The object's custom metadata. */
  metadata?: Record<string, string>;
}

/** One object's metadata plus a readable stream of its content. */
export interface ObjectRead {
  info: ObjectInfo;
  stream: NodeJS.ReadableStream;
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
  encryption?: ObjectEncryption;
}

export interface StorageService {
  uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;
  uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult>;
  uploadFileV2(buffer: Buffer, options: UploadV2Options): Promise<UploadResult>;
  uploadStreamToPath(stream: NodeJS.ReadableStream, options: UploadToPathOptions): Promise<UploadResult>;
  deleteFile(filename: string): Promise<DeleteResult>;
  generateSignedUrl(filename: string, expirationHours?: number): Promise<string>;
  fileExists(filename: string): Promise<boolean>;
  getFileMetadata(filename: string): Promise<FileMetadata>;
  getFileBuffer(path: string, maxRetries?: number, options?: ObjectKeyOptions): Promise<Buffer>;
  downloadFile(remotePath: string, localPath: string, options?: ObjectKeyOptions): Promise<void>;
  createReadStream(path: string, options?: ReadStreamOptions): Promise<NodeJS.ReadableStream>;
  headObject(path: string): Promise<ObjectInfo | null>;
  getObject(path: string, options?: ObjectKeyOptions): Promise<ObjectRead | null>;
  listFiles(prefix: string): Promise<ListedFile[]>;
  listPrefixes(prefix: string): Promise<string[]>;
  moveFile(sourcePath: string, destinationPath: string, options?: ObjectKeyOptions): Promise<void>;
  /** Copy within the bucket, keeping the source. Server-side where the provider supports it. */
  copyFile(sourcePath: string, destinationPath: string, options?: ObjectKeyOptions): Promise<void>;
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
    e?.name === 'PreconditionFailed' ||
    e?.code === 'BlobAlreadyExists'
  );
}
