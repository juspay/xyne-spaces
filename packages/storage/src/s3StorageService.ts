import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'fs';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

import { logger } from './logger.js';
import { generateFilePath } from './pathUtils.js';
import type { StorageService, S3StorageConfig, UploadOptions, UploadResult, DeleteResult, FileMetadata } from './types.js';

export class S3StorageService implements StorageService {
  private client: S3Client;
  private bucketName: string;

  constructor(cfg: S3StorageConfig, bucketName?: string) {
    this.bucketName = bucketName || cfg.bucketName;

    const clientConfig: S3ClientConfig = { region: cfg.region, maxAttempts: 3 };

    if (cfg.accessKeyId && cfg.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      };
    }

    if (cfg.endpoint) {
      clientConfig.endpoint = cfg.endpoint;
      clientConfig.forcePathStyle = true;
      clientConfig.requestChecksumCalculation = 'WHEN_REQUIRED';
      clientConfig.responseChecksumValidation = 'WHEN_REQUIRED';
    }

    this.client = new S3Client(clientConfig);
    logger.info(`S3 Storage Service initialized for bucket: ${this.bucketName}`);
  }

  async uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) throw new Error('File buffer is empty or invalid');
    if (!options.filename) throw new Error('Filename is required');
    if (!options.contentType) throw new Error('Content type is required');

    const filePath = generateFilePath(options);
    logger.info(`Uploading to S3 via multipart stream: ${filePath}`, {
      contentType: options.contentType,
      size: buffer.length,
    });

    await this.uploadBody(
      Readable.from(buffer),
      filePath,
      options.contentType,
      options.metadata,
      'public, max-age=31536000'
    );

    logger.info(`File uploaded to S3: ${filePath}`);
    return { filename: filePath, path: filePath, size: buffer.length };
  }

  async uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult> {
    if (!stream) throw new Error('File stream is empty or invalid');
    if (!(stream instanceof Readable)) throw new Error('File stream must be a Node.js Readable stream');
    if (!options.filename) throw new Error('Filename is required');
    if (!options.contentType) throw new Error('Content type is required');

    const filePath = generateFilePath(options);
    let size = 0;
    const countingStream = new PassThrough();
    countingStream.on('data', (chunk: Buffer | string) => {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    });
    stream.on('error', (error) => countingStream.destroy(error));

    logger.info(`Streaming upload to S3: ${filePath}`, {
      contentType: options.contentType,
    });

    stream.pipe(countingStream);
    await this.uploadBody(
      countingStream,
      filePath,
      options.contentType,
      options.metadata,
      'public, max-age=31536000'
    );

    logger.info(`Stream uploaded to S3: ${filePath}`, { size });
    return { filename: filePath, path: filePath, size };
  }


  async uploadFileV2(buffer: Buffer, options: { path: string; contentType: string; cacheControl?: string; metadata?: Record<string, string>; ifNotExists?: boolean; timeoutMs?: number }): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) throw new Error('File buffer is empty or invalid');
    if (!options.path) throw new Error('Path is required');
    if (!options.contentType) throw new Error('Content type is required');

    logger.info(`Uploading to S3 via multipart stream: ${options.path}`, {
      contentType: options.contentType,
      size: buffer.length,
    });

    await this.uploadBody(
      Readable.from(buffer),
      options.path,
      options.contentType,
      options.metadata,
      options.cacheControl,
      options.ifNotExists
    );

    logger.info(`File uploaded to S3: ${options.path}`);
    return { filename: options.path, path: options.path, size: buffer.length };
  }

  async uploadStreamToPath(
    stream: NodeJS.ReadableStream,
    options: { path: string; contentType: string; metadata?: Record<string, string>; ifNotExists?: boolean; resumable?: boolean; timeoutMs?: number; chunkSize?: number }
  ): Promise<UploadResult> {
    if (!stream) throw new Error('File stream is empty or invalid');
    if (!options.path) throw new Error('Path is required');
    if (!options.contentType) throw new Error('Content type is required');

    let size = 0;
    const countingStream = new PassThrough();
    countingStream.on('data', (chunk: Buffer | string) => {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    });
    stream.on('error', (error) => countingStream.destroy(error));
    stream.pipe(countingStream);

    await this.uploadBody(
      countingStream,
      options.path,
      options.contentType,
      options.metadata,
      undefined,
      options.ifNotExists
    );

    logger.info(`Stream uploaded to S3 at exact path: ${options.path}`, { size });
    return { filename: options.path, path: options.path, size };
  }

  async deleteFile(filename: string): Promise<DeleteResult> {
    if (!filename) throw new Error('Filename is required for deletion');

    const exists = await this.fileExists(filename);
    if (!exists) {
      logger.warn(`File does not exist in S3: ${filename}`);
      return { filename, deleted: false };
    }

    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: filename }));
    logger.info(`File deleted from S3: ${filename}`);
    return { filename, deleted: true };
  }

  async generateSignedUrl(filename: string, expirationHours: number = 24): Promise<string> {
    if (!filename) throw new Error('Filename is required for signed URL generation');

    const exists = await this.fileExists(filename);
    if (!exists) throw new Error(`File does not exist: ${filename}`);

    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucketName, Key: filename }),
      { expiresIn: expirationHours * 3600 }
    );
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: filename }));
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return false;
      logger.error(`Failed to check file existence: ${filename}`, error);
      return false;
    }
  }

  async getFileMetadata(filename: string): Promise<FileMetadata> {
    const resp = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: filename }));
    return {
      contentType: resp.ContentType,
      size: resp.ContentLength,
      metadata: resp.Metadata,
      lastModified: resp.LastModified,
    };
  }

  async getFileBuffer(path: string, maxRetries: number = 3): Promise<Buffer> {
    const initialDelay = 1000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!path) throw new Error('Path is required for file content retrieval');

        const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: path }));
        const chunks: Buffer[] = [];
        for await (const chunk of resp.Body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }

        if (attempt > 1) logger.info(`Successfully fetched file from S3 after ${attempt} attempts: ${path}`);
        return Buffer.concat(chunks);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        if (attempt === maxRetries) break;

        const delay = initialDelay * Math.pow(2, attempt - 1);
        logger.warn(`Attempt ${attempt}/${maxRetries} failed to fetch from S3: ${path}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`S3 file read failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!remotePath) throw new Error('Remote path is required');
    if (!localPath) throw new Error('Local path is required');

    const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName, Key: remotePath }));
    await pipeline(resp.Body as Readable, createWriteStream(localPath));
    logger.info(`File downloaded from S3: ${remotePath} to ${localPath}`);
  }

  async createReadStream(path: string, options?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream> {
    if (!path) throw new Error('Path is required for creating read stream');

    const params: any = { Bucket: this.bucketName, Key: path };
    if (options?.start !== undefined || options?.end !== undefined) {
      const start = options?.start ?? 0;
      const end = options?.end !== undefined ? options.end : '';
      params.Range = `bytes=${start}-${end}`;
    }

    const resp = await this.client.send(new GetObjectCommand(params));
    return resp.Body as NodeJS.ReadableStream;
  }

  async listFiles(prefix: string): Promise<Array<{ name: string; contentType?: string; size?: number; updated?: Date }>> {
    const results: Array<{ name: string; contentType?: string; size?: number; updated?: Date }> = [];
    let continuationToken: string | undefined;

    do {
      const resp = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of resp.Contents ?? []) {
        if (obj.Key) {
          results.push({
            name: obj.Key,
            ...(obj.Size !== undefined ? { size: obj.Size } : {}),
            ...(obj.LastModified ? { updated: obj.LastModified } : {}),
          });
        }
      }

      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.client.send(new CopyObjectCommand({
      Bucket: this.bucketName,
      CopySource: `${this.bucketName}/${sourcePath}`,
      Key: destinationPath,
    }));

    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: sourcePath }));
    } catch (error) {
      logger.warn(`File copied to ${destinationPath} but failed to delete source ${sourcePath} — file exists in both locations`, error);
      throw error;
    }

    logger.info(`File moved in S3: ${sourcePath} -> ${destinationPath}`);
  }

  async ensureBucketExists(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      logger.info(`S3 bucket exists: ${this.bucketName}`);
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        logger.info(`Creating S3 bucket: ${this.bucketName}`);
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
        logger.info(`S3 bucket created: ${this.bucketName}`);
      } else {
        throw error;
      }
    }
  }

  async checkBucketExists(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
      logger.info(`S3 bucket exists: ${this.bucketName}`);
    } catch {
      throw new Error(`S3 bucket does not exist: ${this.bucketName}`);
    }
  }

  public getBucketName(): string {
    return this.bucketName;
  }

  buildStorageUri(path: string): string {
    return `s3://${this.bucketName}/${path}`;
  }

  private sanitizeMetadata(metadata?: Record<string, string>): Record<string, string> | undefined {
    return metadata
      ? Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, v.replace(/[^\x20-\x7E]/g, '_')]))
      : undefined;
  }

  private async uploadBody(
    body: Readable,
    filePath: string,
    contentType: string,
    metadata?: Record<string, string>,
    cacheControl: string = 'public, max-age=31536000',
    ifNotExists?: boolean
  ): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucketName,
        Key: filePath,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: this.sanitizeMetadata(metadata),
        ...(ifNotExists ? { IfNoneMatch: '*' } : {}),
      },
      queueSize: 2,
      partSize: 5 * 1024 * 1024,
      leavePartsOnError: false,
    });

    await upload.done();
  }
}
