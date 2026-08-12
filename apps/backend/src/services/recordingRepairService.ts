import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import {
  recordingRepairStorageService,
  type RecordingRepairChunkMetadata,
} from '@/services/recordingRepairStorageService';
import { voiceInputService } from '@/services/voiceInputService';
import { logger } from '@/utils/logger';
import { isStandaloneWebm } from '@/utils/webm';
import { intersectRecordingRepairCoverage } from '@/services/recordingRepairIntervals';

export class RecordingRepairTerminalError extends Error {
  override readonly name = 'RecordingRepairTerminalError';
}

class RecordingRepairService {
  async process(callId: string, captureId: string): Promise<void> {
    const capture = await recordingRepairStateService.claim(callId, captureId);
    if (!capture) return;

    let chunks: RecordingRepairChunkMetadata[] = [];
    try {
      chunks = await recordingRepairStorageService.listChunks(callId, captureId);
      const selected = chunks.filter(chunk =>
        capture.outages.some(outage =>
          chunk.startedAt < outage.endedAt && chunk.endedAt > outage.startedAt,
        ),
      );
      if (selected.length === 0) {
        throw new RecordingRepairTerminalError('No repair chunks overlap the finalized outages');
      }

      const repairs: Array<{ user: string; text: string; timestamp: number; participant_identity: string }> = [];
      for (const chunk of selected) {
        const buffer = await recordingRepairStorageService.readChunk(chunk.path);
        if (!isStandaloneWebm(buffer)) {
          throw new RecordingRepairTerminalError(
            `Stored recording repair chunk ${chunk.sequence} has no standalone WebM header`,
          );
        }
        const result = await voiceInputService.transcribeAudio({
          buffer,
          size: chunk.size,
          mimetype: chunk.mimeType,
          originalname: `${chunk.sequence}.webm`,
        } as Express.Multer.File);
        if (result.text.trim()) {
          repairs.push({
            user: 'Recovered audio',
            text: result.text.trim(),
            timestamp: chunk.startedAt / 1000,
            participant_identity: '',
          });
        }
      }

      await noteTakerTranscriptService.applyRecordingRepair(
        callId,
        repairs,
        intersectRecordingRepairCoverage(selected, capture.outages),
      );
      await recordingRepairStateService.markMerged(callId, captureId);
      void recordingRepairStorageService.deleteChunks(chunks).catch(error => {
        logger.warn('[RecordingRepairService] Post-merge chunk cleanup failed', {
          callId,
          captureId,
          error,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure =
        error instanceof RecordingRepairTerminalError || message === 'Headless recording not found'
          ? error instanceof RecordingRepairTerminalError
            ? error
            : new RecordingRepairTerminalError(message)
          : error;
      await recordingRepairStateService.markFailed(
        callId,
        captureId,
        message,
        !(failure instanceof RecordingRepairTerminalError),
      );
      logger.error('[RecordingRepairService] Repair processing failed', { callId, captureId, error });
      throw failure;
    }
  }
}

export const recordingRepairService = new RecordingRepairService();
