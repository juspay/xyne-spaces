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

export interface StorageService {
  uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult>;
  uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult>;
  uploadFileV2(buffer: Buffer, options: { path: string; contentType: string; cacheControl?: string; metadata?: Record<string, string> }): Promise<UploadResult>;
  deleteFile(filename: string): Promise<DeleteResult>;
  generateSignedUrl(filename: string, expirationHours?: number): Promise<string>;
  fileExists(filename: string): Promise<boolean>;
  getFileMetadata(filename: string): Promise<FileMetadata>;
  getFileBuffer(path: string, maxRetries?: number): Promise<Buffer>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  createReadStream(path: string, options?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream>;
  listFiles(prefix: string): Promise<Array<{ name: string; contentType?: string }>>;
  moveFile(sourcePath: string, destinationPath: string): Promise<void>;
  ensureBucketExists(): Promise<void>;
  checkBucketExists(): Promise<void>;
  buildStorageUri(path: string): string;
}
