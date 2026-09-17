import { config } from '@/config/env';
import { getStorageService, type ListedFile, type StorageService } from '@/services/storage';

// GCS layout for the offline-first recorder redo path:
//   recording-repairs/{callId}/{captureId}/recording.webm   (the whole capture)
// The client streams the ONE recording.webm through the backend, which writes it
// here server-side (no direct-to-GCS PUT, no bucket CORS). The redo hands the whole
// file to the transcription agent as-is — no reconstruction, no per-fragment
// concatenation. The same object is registered as the call's served recording.

const AUDIO_CONTENT_TYPE = 'audio/webm';

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
