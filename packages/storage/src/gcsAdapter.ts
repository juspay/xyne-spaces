import { GCSService } from './gcsService.js';
import type { StorageService, UploadOptions, UploadResult, UploadToPathOptions, UploadV2Options, DeleteResult, FileMetadata, ListedFile, ObjectInfo, ObjectKeyOptions, ObjectRead, ReadStreamOptions } from './types.js';

export class GCSAdapter implements StorageService {
  constructor(private gcs: GCSService) {}

  async uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const r = await this.gcs.uploadFile(buffer, options);
    return { filename: r.filename, path: r.gcsPath, size: r.size };
  }

  async uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult> {
    const r = await this.gcs.uploadStream(stream, options);
    return { filename: r.filename, path: r.gcsPath, size: r.size };
  }

  async uploadFileV2(buffer: Buffer, options: UploadV2Options): Promise<UploadResult> {
    const gcsOptions = {
      path: options.path,
      contentType: options.contentType,
      metadata: {
        ...options.metadata,
        ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
      },
      ...(options.ifNotExists ? { ifNotExists: true } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.encryption ? { encryption: options.encryption } : {}),
    };
    const r = await this.gcs.uploadFileV2(buffer, gcsOptions);
    return { filename: r.filename, path: r.gcsPath, size: r.size };
  }

  async uploadStreamToPath(stream: NodeJS.ReadableStream, options: UploadToPathOptions): Promise<UploadResult> {
    const r = await this.gcs.uploadStreamToPath(stream, options);
    return { filename: r.filename, path: r.gcsPath, size: r.size };
  }

  async deleteFile(filename: string): Promise<DeleteResult> {
    return this.gcs.deleteFile(filename);
  }

  async generateSignedUrl(filename: string, expirationHours?: number): Promise<string> {
    return this.gcs.generateSignedUrl(filename, expirationHours);
  }

  async fileExists(filename: string): Promise<boolean> {
    return this.gcs.fileExists(filename);
  }

  async getFileMetadata(filename: string): Promise<FileMetadata> {
    return this.gcs.getFileMetadata(filename);
  }

  async getFileBuffer(path: string, maxRetries?: number, options?: ObjectKeyOptions): Promise<Buffer> {
    return this.gcs.getFileBuffer(path, maxRetries, options);
  }

  async downloadFile(remotePath: string, localPath: string, options?: ObjectKeyOptions): Promise<void> {
    return this.gcs.downloadFile(remotePath, localPath, options);
  }

  async createReadStream(path: string, options?: ReadStreamOptions): Promise<NodeJS.ReadableStream> {
    return this.gcs.createReadStream(path, options);
  }

  async headObject(path: string): Promise<ObjectInfo | null> {
    return this.gcs.headObject(path);
  }

  async getObject(path: string, options?: ObjectKeyOptions): Promise<ObjectRead | null> {
    return this.gcs.getObject(path, options);
  }

  async listFiles(prefix: string): Promise<ListedFile[]> {
    return this.gcs.listFiles(prefix);
  }

  async listPrefixes(prefix: string): Promise<string[]> {
    return this.gcs.listPrefixes(prefix);
  }

  async moveFile(sourcePath: string, destinationPath: string, options?: ObjectKeyOptions): Promise<void> {
    return this.gcs.moveFile(sourcePath, destinationPath, options);
  }

  async copyFile(sourcePath: string, destinationPath: string, options?: ObjectKeyOptions): Promise<void> {
    return this.gcs.copyFile(sourcePath, destinationPath, options);
  }

  async ensureBucketExists(): Promise<void> {
    return this.gcs.ensureBucketExists();
  }

  async checkBucketExists(): Promise<void> {
    return this.gcs.checkBucketExists();
  }

  buildStorageUri(path: string): string {
    return `gs://${this.gcs.getBucketName()}/${path}`;
  }
}
