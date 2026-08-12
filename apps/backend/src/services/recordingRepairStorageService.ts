import { config } from '@/config/env';
import { getStorageService, type StorageService } from '@/services/storage';
import { logger } from '@/utils/logger';

export interface RecordingRepairChunkMetadata {
  path: string;
  sequence: number;
  startedAt: number;
  endedAt: number;
  sha256: string;
  mimeType: string;
  size: number;
}

export interface RecordingRepairChunkInput {
  sequence: number;
  startedAt: number;
  endedAt: number;
  sha256: string;
  mimeType: string;
}

class RecordingRepairStorageService {
  constructor(
    private readonly storage: StorageService = getStorageService(
      config.gcs.transcriptionBucketName,
    ),
  ) {}

  chunkPath(callId: string, captureId: string, sequence: number): string {
    return `recording-repairs/${callId}/${captureId}/${sequence}.webm`;
  }

  capturePrefix(callId: string, captureId: string): string {
    return `recording-repairs/${callId}/${captureId}/`;
  }

  async writeChunkIfAbsent(
    callId: string,
    captureId: string,
    buffer: Buffer,
    input: RecordingRepairChunkInput,
  ): Promise<{ created: boolean; chunk: RecordingRepairChunkMetadata | null }> {
    const path = this.chunkPath(callId, captureId, input.sequence);
    const result = await this.storage.uploadFileIfAbsent(buffer, {
      path,
      contentType: input.mimeType,
      cacheControl: 'private, max-age=0',
      metadata: {
        sequence: String(input.sequence),
        startedat: String(input.startedAt),
        endedat: String(input.endedAt),
        sha256: input.sha256,
        mimetype: input.mimeType,
      },
    });
    return {
      created: result.created,
      chunk: result.created
        ? { path, size: buffer.length, ...input }
        : await this.getChunk(path),
    };
  }

  async getChunk(path: string): Promise<RecordingRepairChunkMetadata | null> {
    try {
      if (!(await this.storage.fileExists(path))) return null;
      return this.parse(path, await this.storage.getFileMetadata(path));
    } catch (error) {
      logger.warn('[RecordingRepairStorage] Failed to read chunk metadata', { path, error });
      throw error;
    }
  }

  async listChunks(callId: string, captureId: string): Promise<RecordingRepairChunkMetadata[]> {
    const files = await this.storage.listFiles(this.capturePrefix(callId, captureId));
    const chunks = await Promise.all(files.map(file => this.getChunk(file.name)));
    return chunks
      .filter((chunk): chunk is RecordingRepairChunkMetadata => chunk !== null)
      .sort((a, b) => a.sequence - b.sequence || a.startedAt - b.startedAt);
  }

  async readChunk(path: string): Promise<Buffer> {
    return this.storage.getFileBuffer(path);
  }

  async deleteChunks(chunks: RecordingRepairChunkMetadata[]): Promise<void> {
    await Promise.allSettled(chunks.map(chunk => this.storage.deleteFile(chunk.path)));
  }

  private parse(
    path: string,
    file: { size?: number | string; contentType?: string; metadata?: Record<string, string> },
  ): RecordingRepairChunkMetadata | null {
    const metadata = file.metadata ?? {};
    const sequence = Number(metadata.sequence);
    const startedAt = Number(metadata.startedat ?? metadata.startedAt);
    const endedAt = Number(metadata.endedat ?? metadata.endedAt);
    const size = Number(file.size);
    const sha256 = metadata.sha256;
    const mimeType = metadata.mimetype ?? metadata.mimeType ?? file.contentType;
    if (
      !Number.isInteger(sequence) ||
      sequence < 0 ||
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt <= startedAt ||
      !Number.isFinite(size) ||
      !/^[a-f0-9]{64}$/i.test(sha256 ?? '') ||
      !mimeType
    ) {
      logger.warn('[RecordingRepairStorage] Ignoring invalid chunk metadata', { path });
      return null;
    }
    return { path, sequence, startedAt, endedAt, size, sha256: sha256!, mimeType };
  }
}

export const recordingRepairStorageService = new RecordingRepairStorageService();
