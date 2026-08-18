import type { RecordingCaptureManifest } from '@xyne/shared';
import { config } from '@/config/env';
import { getStorageService, type ListedFile, type StorageService } from '@/services/storage';

// GCS layout for the offline-first recorder repair path:
//   recording-repairs/{callId}/{captureId}/recording.webm       (the whole capture)
//   recording-repairs/{callId}/{captureId}/chunk_manifest.json  (source of truth)
// The client stitches the capture locally and streams the ONE recording.webm plus
// the manifest through the backend, which writes them here server-side (no
// direct-to-GCS PUT, no bucket CORS). The worker hands the whole file to the
// transcription agent as-is — no reconstruction, no per-fragment concatenation.

const AUDIO_CONTENT_TYPE = 'application/octet-stream';
const MANIFEST_CONTENT_TYPE = 'application/json';

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

  audioPath(callId: string, captureId: string): string {
    return `${this.capturePrefix(callId, captureId)}recording.webm`;
  }

  manifestPath(callId: string, captureId: string): string {
    return `${this.capturePrefix(callId, captureId)}chunk_manifest.json`;
  }

  /** Stream the whole capture (one WebM) through to storage without buffering it. */
  async writeAudioStream(
    callId: string,
    captureId: string,
    stream: NodeJS.ReadableStream,
  ): Promise<void> {
    await this.storage.uploadStreamToPath(stream, {
      path: this.audioPath(callId, captureId),
      contentType: AUDIO_CONTENT_TYPE,
    });
  }

  /** Whether the capture's recording.webm has been uploaded. */
  audioExists(callId: string, captureId: string): Promise<boolean> {
    return this.storage.fileExists(this.audioPath(callId, captureId));
  }

  /** Download the whole capture for the transcription agent. */
  readAudio(callId: string, captureId: string): Promise<Buffer> {
    return this.storage.getFileBuffer(this.audioPath(callId, captureId));
  }

  /** Write the manifest — the capture's commit marker — to storage. */
  async writeManifest(
    callId: string,
    captureId: string,
    manifest: RecordingCaptureManifest,
  ): Promise<void> {
    await this.storage.uploadFileV2(Buffer.from(JSON.stringify(manifest), 'utf8'), {
      path: this.manifestPath(callId, captureId),
      contentType: MANIFEST_CONTENT_TYPE,
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
}

export const recordingRepairStorageService = new RecordingRepairStorageService();
