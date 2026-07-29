import { getStorageService, type StorageService } from '@/services/storage';
import type { ConversationSourceAdapter, MemoryIngestionContext } from '../types';

/**
 * Parse a full GCS URI into bucket name and file path.
 * Accepts: gs://bucket-name/path/to/file.json
 */
export function parseGcsUri(gcsUri: string): { bucketName: string; filePath: string } {
  const match = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`[BaseGcsAdapter] Invalid GCS URI format: "${gcsUri}". Expected gs://bucket-name/path/to/file.json`);
  }
  return { bucketName: match[1], filePath: match[2] };
}

export abstract class BaseGcsAdapter implements ConversationSourceAdapter {
  protected readonly bucketName: string;
  protected readonly filePath: string;
  protected readonly storageService: StorageService;

  // Memoized raw payload — avoids double GCS download
  private rawPayloadCache: unknown | undefined = undefined;

  constructor(
    protected readonly gcsUri: string,
    protected readonly sourceId: string,
  ) {
    const parsed = parseGcsUri(gcsUri);
    this.bucketName = parsed.bucketName;
    this.filePath = parsed.filePath;
    this.storageService = getStorageService(this.bucketName);
  }

  /**
   * Download and parse the GCS file exactly once. Subsequent calls return the cached result.
   */
  protected async getRawPayload(): Promise<unknown> {
    if (this.rawPayloadCache === undefined) {
      const buffer = await this.storageService.getFileBuffer(this.filePath);
      this.rawPayloadCache = JSON.parse(buffer.toString('utf-8'));
    }
    return this.rawPayloadCache;
  }

  /**
   * Default implementation: raw payload is expected to be an array (e.g. workflow steps).
   * Override in adapters where the array is nested (e.g. SessionAdapter → payload.messages).
   */
  async getItems(): Promise<unknown[]> {
    const payload = await this.getRawPayload();
    if (!Array.isArray(payload)) {
      throw new Error(`[BaseGcsAdapter] Expected array at root of ${this.gcsUri}, got ${typeof payload}`);
    }
    return payload;
  }

  abstract buildMemoryContext(): Promise<MemoryIngestionContext>;
}
