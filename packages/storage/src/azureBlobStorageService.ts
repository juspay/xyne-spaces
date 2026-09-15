import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  RestError,
  generateBlobSASQueryParameters,
  type BlobHTTPHeaders,
  type BlockBlobUploadStreamOptions,
  type ContainerClient,
} from '@azure/storage-blob';
import { PassThrough, Readable } from 'stream';

import { logger } from './logger.js';
import { generateFilePath } from './pathUtils.js';
import type {
  AzureStorageConfig,
  DeleteResult,
  FileMetadata,
  ListedFile,
  ObjectInfo,
  ObjectRead,
  StorageService,
  UploadOptions,
  UploadResult,
  UploadToPathOptions,
} from './types.js';

/** Block size for streamed uploads; Azure allows up to 4000 MiB per block, 4 MiB keeps buffering small. */
const DEFAULT_BLOCK_SIZE = 4 * 1024 * 1024;
const UPLOAD_CONCURRENCY = 4;
/** User delegation keys (OAuth-signed SAS) are valid for at most seven days. */
const MAX_DELEGATION_HOURS = 7 * 24;

/** Trailing-slash trim without a regex: an endpoint is caller input and `/\/+$/` backtracks. */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return value.slice(0, end);
}

function logSafe(value: string): string {
  return JSON.stringify(String(value));
}

/**
 * Azure Blob Storage through the official SDK. Credentials come from, in order:
 * a connection string, a SAS token, anonymous (public container), or
 * DefaultAzureCredential (env vars, workload identity, managed identity, CLI).
 */
export class AzureBlobStorageService implements StorageService {
  private readonly service: BlobServiceClient;
  private readonly container: ContainerClient;
  private readonly containerName: string;
  private readonly credential: DefaultAzureCredential | undefined;

  constructor(cfg: AzureStorageConfig, containerName?: string) {
    this.containerName = containerName || cfg.containerName;

    if (cfg.connectionString) {
      this.service = BlobServiceClient.fromConnectionString(cfg.connectionString);
    } else {
      const rawEndpoint =
        cfg.endpoint ?? (cfg.accountName ? `https://${cfg.accountName}.blob.core.windows.net` : undefined);
      const endpoint = rawEndpoint === undefined ? undefined : stripTrailingSlashes(rawEndpoint);
      if (!endpoint) throw new Error('AzureStorageConfig needs accountName, endpoint or connectionString');

      if (cfg.sasToken) {
        this.service = new BlobServiceClient(`${endpoint}?${cfg.sasToken.replace(/^\?/, '')}`);
      } else if (cfg.anonymous) {
        this.service = new BlobServiceClient(endpoint);
      } else {
        this.credential = new DefaultAzureCredential();
        this.service = new BlobServiceClient(endpoint, this.credential);
      }
    }

    this.container = this.service.getContainerClient(this.containerName);
    logger.info(`Azure Blob Storage Service initialized for container: ${this.containerName}`);
  }

  async uploadFile(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) throw new Error('File buffer is empty or invalid');
    if (!options.filename) throw new Error('Filename is required');
    if (!options.contentType) throw new Error('Content type is required');

    const filePath = generateFilePath(options);
    logger.info(`Uploading to Azure Blob: ${logSafe(filePath)}`, { contentType: options.contentType, size: buffer.length });

    await this.uploadBody(Readable.from(buffer), filePath, options.contentType, options.metadata, 'public, max-age=31536000');

    logger.info(`File uploaded to Azure Blob: ${logSafe(filePath)}`);
    return { filename: filePath, path: filePath, size: buffer.length };
  }

  async uploadStream(stream: NodeJS.ReadableStream, options: UploadOptions): Promise<UploadResult> {
    if (!stream) throw new Error('File stream is empty or invalid');
    if (!options.filename) throw new Error('Filename is required');
    if (!options.contentType) throw new Error('Content type is required');

    const filePath = generateFilePath(options);
    const { body, size } = this.countingBody(stream);
    logger.info(`Streaming upload to Azure Blob: ${logSafe(filePath)}`, { contentType: options.contentType });

    await this.uploadBody(body, filePath, options.contentType, options.metadata, 'public, max-age=31536000');

    logger.info(`Stream uploaded to Azure Blob: ${logSafe(filePath)}`, { size: size() });
    return { filename: filePath, path: filePath, size: size() };
  }

  async uploadFileV2(
    buffer: Buffer,
    options: { path: string; contentType: string; cacheControl?: string; metadata?: Record<string, string>; ifNotExists?: boolean; timeoutMs?: number }
  ): Promise<UploadResult> {
    if (!buffer || buffer.length === 0) throw new Error('File buffer is empty or invalid');
    if (!options.path) throw new Error('Path is required');
    if (!options.contentType) throw new Error('Content type is required');

    logger.info(`Uploading to Azure Blob: ${logSafe(options.path)}`, { contentType: options.contentType, size: buffer.length });

    await this.uploadBody(Readable.from(buffer), options.path, options.contentType, options.metadata, options.cacheControl, options.ifNotExists);

    logger.info(`File uploaded to Azure Blob: ${logSafe(options.path)}`);
    return { filename: options.path, path: options.path, size: buffer.length };
  }

  async uploadStreamToPath(stream: NodeJS.ReadableStream, options: UploadToPathOptions): Promise<UploadResult> {
    if (!stream) throw new Error('File stream is empty or invalid');
    if (!options.path) throw new Error('Path is required');
    if (!options.contentType) throw new Error('Content type is required');

    const { body, size } = this.countingBody(stream);
    await this.uploadBody(body, options.path, options.contentType, options.metadata, undefined, options.ifNotExists, options.chunkSize);

    logger.info(`Stream uploaded to Azure Blob at exact path: ${logSafe(options.path)}`, { size: size() });
    return { filename: options.path, path: options.path, size: size() };
  }

  async deleteFile(filename: string): Promise<DeleteResult> {
    if (!filename) throw new Error('Filename is required for deletion');

    const resp = await this.container.getBlobClient(filename).deleteIfExists();
    if (!resp.succeeded) {
      logger.warn(`File does not exist in Azure Blob: ${logSafe(filename)}`);
      return { filename, deleted: false };
    }
    logger.info(`File deleted from Azure Blob: ${logSafe(filename)}`);
    return { filename, deleted: true };
  }

  /**
   * Read URL for one blob. With a SAS token or anonymous access the client URL
   * already carries what is needed; with OAuth a user delegation SAS is minted
   * (valid for at most seven days).
   */
  async generateSignedUrl(filename: string, expirationHours: number = 24): Promise<string> {
    if (!filename) throw new Error('Filename is required for signed URL generation');

    const blob = this.container.getBlobClient(filename);
    const exists = await blob.exists();
    if (!exists) throw new Error(`File does not exist: ${filename}`);

    if (!this.credential) {
      return blob.url;
    }

    const hours = Math.min(expirationHours, MAX_DELEGATION_HOURS);
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + hours * 3600 * 1000);
    const delegationKey = await this.service.getUserDelegationKey(startsOn, expiresOn);
    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.containerName,
        blobName: filename,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
      },
      delegationKey,
      this.service.accountName
    ).toString();
    return `${blob.url}?${sas}`;
  }

  private static isNotFound(error: unknown): boolean {
    return error instanceof RestError && error.statusCode === 404;
  }

  private static toObjectInfo(props: {
    contentLength?: number;
    contentType?: string;
    etag?: string;
    lastModified?: Date;
  }): ObjectInfo {
    const info: ObjectInfo = {};
    if (props.contentLength !== undefined) {
      info.size = props.contentLength;
    }
    if (props.contentType) {
      info.contentType = props.contentType;
    }
    if (props.etag) {
      info.etag = props.etag.replace(/^W\//, '').replace(/"/g, '');
    }
    if (props.lastModified) {
      info.lastModified = props.lastModified;
    }
    return info;
  }

  /** Metadata for one object, or null when it does not exist. */
  async headObject(path: string): Promise<ObjectInfo | null> {
    try {
      const props = await this.container.getBlobClient(path).getProperties();
      return AzureBlobStorageService.toObjectInfo(props);
    } catch (error) {
      if (AzureBlobStorageService.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Stream one object with its metadata, or null when it does not exist. */
  async getObject(path: string): Promise<ObjectRead | null> {
    try {
      const resp = await this.container.getBlobClient(path).download();
      if (!resp.readableStreamBody) {
        throw new Error(`Azure Blob download returned no body: ${path}`);
      }
      return { info: AzureBlobStorageService.toObjectInfo(resp), stream: resp.readableStreamBody };
    } catch (error) {
      if (AzureBlobStorageService.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      return await this.container.getBlobClient(filename).exists();
    } catch (error) {
      logger.error(`Failed to check file existence: ${logSafe(filename)}`, error);
      return false;
    }
  }

  async getFileMetadata(filename: string): Promise<FileMetadata> {
    const props = await this.container.getBlobClient(filename).getProperties();
    return {
      contentType: props.contentType,
      size: props.contentLength,
      metadata: props.metadata,
      lastModified: props.lastModified,
    };
  }

  async getFileBuffer(path: string, maxRetries: number = 3): Promise<Buffer> {
    const initialDelay = 1000;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!path) throw new Error('Path is required for file content retrieval');

        const buffer = await this.container.getBlobClient(path).downloadToBuffer();
        if (attempt > 1) logger.info(`Successfully fetched file from Azure Blob after ${attempt} attempts: ${logSafe(path)}`);
        return buffer;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        if (attempt === maxRetries) break;

        const delay = initialDelay * Math.pow(2, attempt - 1);
        logger.warn(`Attempt ${attempt}/${maxRetries} failed to fetch from Azure Blob: ${logSafe(path)}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Azure Blob read failed after ${maxRetries} attempts: ${lastError?.message}`);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    if (!remotePath) throw new Error('Remote path is required');
    if (!localPath) throw new Error('Local path is required');

    await this.container.getBlobClient(remotePath).downloadToFile(localPath);
    logger.info(`File downloaded from Azure Blob: ${logSafe(remotePath)} to ${logSafe(localPath)}`);
  }

  async createReadStream(path: string, options?: { start?: number; end?: number }): Promise<NodeJS.ReadableStream> {
    if (!path) throw new Error('Path is required for creating read stream');

    const offset = options?.start ?? 0;
    const count = options?.end !== undefined ? options.end - offset + 1 : undefined;
    const resp = await this.container.getBlobClient(path).download(offset, count);
    if (!resp.readableStreamBody) {
      throw new Error(`Azure Blob download returned no body: ${path}`);
    }
    return resp.readableStreamBody;
  }

  async listPrefixes(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for await (const item of this.container.listBlobsByHierarchy('/', { prefix })) {
      if (item.kind === 'prefix') {
        out.push(item.name.slice(prefix.length).replace(/\/$/, ''));
      }
    }
    return out;
  }

  async listFiles(prefix: string): Promise<ListedFile[]> {
    const results: ListedFile[] = [];
    for await (const item of this.container.listBlobsFlat({ prefix })) {
      results.push({
        name: item.name,
        ...(item.properties.contentType ? { contentType: item.properties.contentType } : {}),
        ...(item.properties.contentLength !== undefined ? { size: item.properties.contentLength } : {}),
        ...(item.properties.lastModified ? { updated: item.properties.lastModified } : {}),
      });
    }
    return results;
  }

  /**
   * Copy then delete. The copy streams through this process rather than using
   * the server-side copy, which needs a separately authorised source URL and
   * has different limits per auth mode; the callers move small objects.
   */
  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const source = this.container.getBlobClient(sourcePath);
    const props = await source.getProperties();
    const download = await source.download();
    if (!download.readableStreamBody) {
      throw new Error(`Azure Blob download returned no body: ${sourcePath}`);
    }

    await this.uploadBody(
      this.asReadable(download.readableStreamBody),
      destinationPath,
      props.contentType ?? 'application/octet-stream',
      props.metadata,
      props.cacheControl
    );

    try {
      await source.delete();
    } catch (error) {
      logger.warn(`File copied to ${logSafe(destinationPath)} but failed to delete source ${logSafe(sourcePath)} — file exists in both locations`, error);
      throw error;
    }

    logger.info(`File moved in Azure Blob: ${logSafe(sourcePath)} -> ${logSafe(destinationPath)}`);
  }

  async ensureBucketExists(): Promise<void> {
    const resp = await this.container.createIfNotExists();
    if (resp.succeeded) {
      logger.info(`Azure Blob container created: ${this.containerName}`);
    } else {
      logger.info(`Azure Blob container exists: ${this.containerName}`);
    }
  }

  async checkBucketExists(): Promise<void> {
    const exists = await this.container.exists().catch(() => false);
    if (!exists) {
      throw new Error(`Azure Blob container does not exist: ${this.containerName}`);
    }
    logger.info(`Azure Blob container exists: ${this.containerName}`);
  }

  public getBucketName(): string {
    return this.containerName;
  }

  buildStorageUri(path: string): string {
    return `az://${this.containerName}/${path}`;
  }

  /** Azure metadata keys must be C# identifiers and values ASCII. */
  private sanitizeMetadata(metadata?: Record<string, string>): Record<string, string> | undefined {
    if (!metadata) return undefined;
    return Object.fromEntries(
      Object.entries(metadata).map(([k, v]) => {
        const key = k.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
        return [key, v.replace(/[^\x20-\x7E]/g, '_')];
      })
    );
  }

  private asReadable(stream: NodeJS.ReadableStream): Readable {
    if (stream instanceof Readable) return stream;
    const pass = new PassThrough();
    stream.on('error', (error) => pass.destroy(error));
    stream.pipe(pass);
    return pass;
  }

  private countingBody(stream: NodeJS.ReadableStream): { body: Readable; size: () => number } {
    let size = 0;
    const counting = new PassThrough();
    counting.on('data', (chunk: Buffer | string) => {
      size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
    });
    stream.on('error', (error) => counting.destroy(error));
    stream.pipe(counting);
    return { body: counting, size: () => size };
  }

  private async uploadBody(
    body: Readable,
    filePath: string,
    contentType: string,
    metadata?: Record<string, string>,
    cacheControl: string = 'public, max-age=31536000',
    ifNotExists?: boolean,
    blockSize?: number
  ): Promise<void> {
    const headers: BlobHTTPHeaders = { blobContentType: contentType, blobCacheControl: cacheControl };
    const options: BlockBlobUploadStreamOptions = {
      blobHTTPHeaders: headers,
      metadata: this.sanitizeMetadata(metadata),
      // If-None-Match: * fails with 409 BlobAlreadyExists when the blob is there; see isPreconditionFailed.
      ...(ifNotExists ? { conditions: { ifNoneMatch: '*' } } : {}),
    };
    await this.container
      .getBlockBlobClient(filePath)
      .uploadStream(body, blockSize ?? DEFAULT_BLOCK_SIZE, UPLOAD_CONCURRENCY, options);
  }
}
