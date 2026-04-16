import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config } from '../../config/env';
import { logger } from '../../utils/logger';
import { generateFilePath } from './pathUtils';
import type { StorageService, UploadOptions, UploadResult, DeleteResult, FileMetadata } from './types';

export class S3StorageService implements StorageService {
  private client: S3Client;
  private bucketName: string;

  constructor(bucketName?: string) {
    this.bucketName = bucketName || config.s3.bucketName;

    const clientConfig: S3ClientConfig = { region: config.s3.region };

    if (config.s3.accessKeyId) {
      clientConfig.credentials = {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      };
    }

    if (config.s3.endpoint) {
      clientConfig.endpoint = config.s3.endpoint;
      clientConfig.forcePathStyle = true; // for MinIO/LocalStack
      // Disable default request checksums — MinIO doesn't support them
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
    return this.putObject(buffer, filePath, options.contentType, options.metadata);
  }

  async uploadFileV2(buffer: Buffer, options: { path: string; contentType: string; cacheControl?: string; metadata?: Record<string, string> }): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) throw new Error('File buffer is empty or invalid');
    if (!options.path) throw new Error('Path is required');
    if (!options.contentType) throw new Error('Content type is required');

    return this.putObject(buffer, options.path, options.contentType, options.metadata, options.cacheControl);
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

  async listFiles(prefix: string): Promise<Array<{ name: string; contentType?: string }>> {
    const results: Array<{ name: string; contentType?: string }> = [];
    let continuationToken: string | undefined;

    do {
      const resp = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of resp.Contents ?? []) {
        if (obj.Key) {
          results.push({ name: obj.Key });
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

  private async putObject(buffer: Buffer, filePath: string, contentType: string, metadata?: Record<string, string>, cacheControl?: string): Promise<UploadResult> {
    logger.info(`Uploading to S3: ${filePath}`, { contentType, size: buffer.length });

    // S3 metadata is sent as HTTP headers — only ASCII is allowed.
    // Strip non-ASCII characters to avoid signature mismatches.
    const safeMetadata = metadata
      ? Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, v.replace(/[^\x20-\x7E]/g, '_')]))
      : undefined;

    await this.client.send(new PutObjectCommand({
      Bucket: this.bucketName,
      Key: filePath,
      Body: buffer,
      ContentType: contentType,
      CacheControl: cacheControl ?? 'public, max-age=31536000',
      Metadata: safeMetadata,
    }));

    logger.info(`File uploaded to S3: ${filePath}`);
    return { filename: filePath, path: filePath, size: buffer.length };
  }
}
