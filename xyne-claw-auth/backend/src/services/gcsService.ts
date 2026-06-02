import { Storage, type Bucket, type StorageOptions } from "@google-cloud/storage";
import type { Readable } from "node:stream";
import { CONFIG } from "../config.js";

class GCSService {
  private static instance: GCSService | null = null;
  private storage: Storage;
  private bucket: Bucket;
  readonly bucketName: string;

  private constructor() {
    this.bucketName = CONFIG.gcsBucketName;
    const opts: StorageOptions = {};
    if (CONFIG.gcsProjectId) opts.projectId = CONFIG.gcsProjectId;

    const isDev = process.env["NODE_ENV"] !== "production";
    if (isDev && CONFIG.fakeGcsHost) {
      opts.apiEndpoint = CONFIG.fakeGcsHost.startsWith("http") ? CONFIG.fakeGcsHost : `http://${CONFIG.fakeGcsHost}`;
      console.log(`[gcs] using fake-gcs-server at ${opts.apiEndpoint} bucket=${this.bucketName}`);
    } else {
      console.log(`[gcs] using Application Default Credentials bucket=${this.bucketName}`);
    }

    this.storage = new Storage(opts);
    this.bucket = this.storage.bucket(this.bucketName);
  }

  static getInstance(): GCSService {
    if (!this.instance) this.instance = new GCSService();
    return this.instance;
  }

  async uploadFile(buffer: Buffer, destPath: string, mimeType: string): Promise<void> {
    const file = this.bucket.file(destPath);
    await file.save(buffer, {
      contentType: mimeType,
      resumable: false,
      metadata: { contentType: mimeType },
    });
  }

  createReadStream(gcsPath: string, opts?: { start?: number; end?: number }): Readable {
    return this.bucket.file(gcsPath).createReadStream(opts);
  }

  async getFileBuffer(gcsPath: string): Promise<Buffer> {
    const [buf] = await this.bucket.file(gcsPath).download();
    return buf;
  }

  async getMetadata(gcsPath: string): Promise<{ size: number; contentType: string | undefined }> {
    const [meta] = await this.bucket.file(gcsPath).getMetadata();
    const sizeRaw = meta.size;
    const size = typeof sizeRaw === "string" ? Number(sizeRaw) : (sizeRaw ?? 0);
    return { size, contentType: meta.contentType };
  }

  async deleteFile(gcsPath: string): Promise<void> {
    await this.bucket.file(gcsPath).delete({ ignoreNotFound: true });
  }

  async exists(gcsPath: string): Promise<boolean> {
    const [ok] = await this.bucket.file(gcsPath).exists();
    return ok;
  }

  /**
   * List file paths under a prefix. Returns the GCS object names (paths)
   * sorted lexicographically. Used by the session-restore endpoint to find
   * everything archived under `claw-sessions/{conversationId}/`.
   */
  async listFiles(prefix: string): Promise<string[]> {
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => f.name).sort();
  }
}

export const gcsService = GCSService.getInstance();
