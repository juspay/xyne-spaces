import { GCSService } from '../gcsService';
import type { StorageService, UploadOptions, UploadResult, DeleteResult, FileMetadata } from './types';

export class GCSAdapter implements StorageService {
  constructor(private gcs: GCSService) {}

  async uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const r = await this.gcs.uploadFile(buffer, options);
    return { filename: r.filename, path: r.gcsPath, size: r.size };
  }

  async uploadFileV2(buffer: Buffer, options: { path: string; contentType: string; cacheControl?: string; metadata?: Record<string, string> }): Promise<UploadResult> {
    // Merge cacheControl into metadata so GCS picks it up as a first-class header
    const gcsOptions = {
      path: options.path,
      contentType: options.contentType,
      metadata: {
        ...options.metadata,
        ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
      },
    };
    const r = await this.gcs.uploadFileV2(buffer, gcsOptions);
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

  async getFileBuffer(path: string, maxRetries?: number): Promise<Buffer> {
    return this.gcs.getFileBuffer(path, maxRetries);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    return this.gcs.downloadFile(remotePath, localPath);
  }

  async createReadStream(path: string, options?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream> {
    return this.gcs.createReadStream(path, options);
  }

  async listFiles(prefix: string): Promise<Array<{ name: string; contentType?: string }>> {
    return this.gcs.listFiles(prefix);
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    return this.gcs.moveFile(sourcePath, destinationPath);
  }

  async ensureBucketExists(): Promise<void> {
    return this.gcs.ensureBucketExists();
  }

  async checkBucketExists(): Promise<void> {
    return this.gcs.checkBucketExists();
  }
}
