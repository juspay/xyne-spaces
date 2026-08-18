import type { RecordingCaptureManifest } from '@xyne/shared';
import { config } from '@/config/env';
import { getStorageService, type ListedFile, type StorageService } from '@/services/storage';
import { logger } from '@/utils/logger';

// GCS layout for the offline-first recorder repair path:
//   recording-repairs/{callId}/{captureId}/chunks/{sequence}.part   (MediaRecorder fragments)
//   recording-repairs/{callId}/{captureId}/chunk_manifest.json      (source of truth)
// Chunks are uploaded directly by the client via signed PUT URLs; the manifest is
// uploaded LAST as the commit marker. Fragments are NOT standalone WebM — the worker
// concatenates them in sequence order to reconstruct the original recording.

const CHUNK_CONTENT_TYPE = 'application/octet-stream';
const MANIFEST_CONTENT_TYPE = 'application/json';
const UPLOAD_URL_EXPIRY_SECONDS = 15 * 60;

function isNotFound(error: unknown): boolean {
  const status =
    (error as { $metadata?: { httpStatusCode?: number }; code?: number }).$metadata?.httpStatusCode ??
    (error as { code?: number }).code;
  const name = (error as { name?: string }).name;
  return status === 404 || name === 'NoSuchKey' || name === 'NotFound';
}

class RecordingRepairStorageService {
  private readonly storage: StorageService;

  constructor(storage: StorageService = getStorageService(config.gcs.transcriptionBucketName)) {
    this.storage = storage;
  }

  capturePrefix(callId: string, captureId: string): string {
    return `recording-repairs/${callId}/${captureId}/`;
  }

  chunkPartPath(callId: string, captureId: string, sequence: number): string {
    return `${this.capturePrefix(callId, captureId)}chunks/${sequence}.part`;
  }

  manifestPath(callId: string, captureId: string): string {
    return `${this.capturePrefix(callId, captureId)}chunk_manifest.json`;
  }

  chunkUploadUrl(callId: string, captureId: string, sequence: number): Promise<string> {
    return this.storage.generateUploadSignedUrl(this.chunkPartPath(callId, captureId, sequence), {
      contentType: CHUNK_CONTENT_TYPE,
      expirySeconds: UPLOAD_URL_EXPIRY_SECONDS,
    });
  }

  manifestUploadUrl(callId: string, captureId: string): Promise<string> {
    return this.storage.generateUploadSignedUrl(this.manifestPath(callId, captureId), {
      contentType: MANIFEST_CONTENT_TYPE,
      expirySeconds: UPLOAD_URL_EXPIRY_SECONDS,
    });
  }

  async readManifest(callId: string, captureId: string): Promise<RecordingCaptureManifest | null> {
    try {
      const buffer = await this.storage.getFileBuffer(this.manifestPath(callId, captureId));
      return JSON.parse(buffer.toString('utf8')) as RecordingCaptureManifest;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  readChunkPart(callId: string, captureId: string, sequence: number): Promise<Buffer> {
    return this.storage.getFileBuffer(this.chunkPartPath(callId, captureId, sequence));
  }

  /** Sequences whose `.part` object currently exists in storage. */
  async listUploadedSequences(callId: string, captureId: string): Promise<Set<number>> {
    const files = await this.storage.listFiles(`${this.capturePrefix(callId, captureId)}chunks/`);
    const sequences = new Set<number>();
    for (const file of files) {
      const match = /\/chunks\/(\d+)\.part$/.exec(file.name);
      if (match) sequences.add(Number(match[1]));
    }
    return sequences;
  }

  listRepairObjects(): Promise<ListedFile[]> {
    return this.storage.listFiles('recording-repairs/');
  }

  async deleteCaptureObjects(callId: string, captureId: string): Promise<void> {
    const files = await this.storage.listFiles(this.capturePrefix(callId, captureId));
    await this.deletePaths(files.map((file) => file.name));
  }

  async deletePaths(paths: string[]): Promise<void> {
    const results = await Promise.allSettled(paths.map((path) => this.storage.deleteFile(path)));
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected' ? [{ path: paths[index], error: result.reason }] : []
    );
    if (failures.length > 0) {
      throw new Error(
        `Failed to delete ${failures.length} recording repair object(s): ${failures
          .map((failure) => `${failure.path} (${String(failure.error)})`)
          .join(', ')}`
      );
    }
  }

  logMissing(callId: string, captureId: string, missing: number[]): void {
    logger.warn('[RecordingRepairStorage] Manifest references chunk parts missing from storage', {
      callId,
      captureId,
      missing,
    });
  }
}

export const recordingRepairStorageService = new RecordingRepairStorageService();
