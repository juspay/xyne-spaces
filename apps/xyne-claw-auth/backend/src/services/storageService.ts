import { PassThrough, type Readable } from "node:stream";
import { createStorageService, setStorageLogger, type StorageService } from "@xyne/storage";
import { CONFIG } from "../config.js";

import { createLogger } from "../logger.js";
const log = createLogger("gcsService");

setStorageLogger({
  info: (msg, ...meta) => log.info(msg, ...meta),
  warn: (msg, ...meta) => log.warn(msg, ...meta),
  error: (msg, ...meta) => log.error(msg, ...meta),
});

function buildService(): StorageService {
  const fakeGcsEndpoint =
    !CONFIG.isProduction && CONFIG.fakeGcsHost
      ? CONFIG.fakeGcsHost.startsWith("http")
        ? CONFIG.fakeGcsHost
        : `http://${CONFIG.fakeGcsHost}`
      : undefined;

  return createStorageService({
    provider: CONFIG.storageProvider,
    gcs: {
      bucketName: CONFIG.gcsBucketName,
      ...(CONFIG.gcsProjectId ? { projectId: CONFIG.gcsProjectId } : {}),
      ...(fakeGcsEndpoint ? { apiEndpoint: fakeGcsEndpoint } : {}),
    },
    s3: {
      region: CONFIG.s3Region,
      bucketName: CONFIG.s3BucketName,
      ...(CONFIG.s3Endpoint ? { endpoint: CONFIG.s3Endpoint } : {}),
      ...(CONFIG.s3AccessKeyId
        ? { accessKeyId: CONFIG.s3AccessKeyId, secretAccessKey: CONFIG.s3SecretAccessKey }
        : {}),
    },
  });
}

class GCSService {
  private static instance: GCSService | null = null;
  private storage: StorageService;
  readonly bucketName: string;

  private constructor() {
    this.bucketName =
      CONFIG.storageProvider === "s3" ? CONFIG.s3BucketName : CONFIG.gcsBucketName;
    this.storage = buildService();
  }

  static getInstance(): GCSService {
    if (!this.instance) this.instance = new GCSService();
    return this.instance;
  }

  async uploadFile(buffer: Buffer, destPath: string, mimeType: string): Promise<void> {
    await this.storage.uploadFileV2(buffer, { path: destPath, contentType: mimeType });
  }

  createReadStream(gcsPath: string, opts?: { start?: number; end?: number }): Readable {
    const out = new PassThrough();
    this.storage
      .createReadStream(gcsPath, opts)
      .then((stream) => {
        stream.on("error", (err: Error) => out.destroy(err));
        stream.pipe(out);
      })
      .catch((err: Error) => out.destroy(err));
    return out;
  }

  async getFileBuffer(gcsPath: string): Promise<Buffer> {
    return this.storage.getFileBuffer(gcsPath);
  }

  async getMetadata(gcsPath: string): Promise<{ size: number; contentType: string | undefined }> {
    const meta = await this.storage.getFileMetadata(gcsPath);
    const size = typeof meta.size === "string" ? Number(meta.size) : (meta.size ?? 0);
    return { size, contentType: meta.contentType };
  }

  async deleteFile(gcsPath: string): Promise<void> {
    await this.storage.deleteFile(gcsPath);
  }

  async exists(gcsPath: string): Promise<boolean> {
    return this.storage.fileExists(gcsPath);
  }

  /**
   * List file paths under a prefix. Returns object names (paths) sorted
   * lexicographically. Used by the session-restore endpoint to find
   * everything archived under `claw-sessions/{conversationId}/`.
   */
  async listFiles(prefix: string): Promise<string[]> {
    const files = await this.storage.listFiles(prefix);
    return files.map((f) => f.name).sort();
  }
}

export const gcsService = GCSService.getInstance();
