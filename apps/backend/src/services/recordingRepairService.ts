import { gcsService } from '@/services/gcsService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import { transcriptService } from '@/services/transcriptService';
import { voiceInputService } from '@/services/voiceInputService';
import { logger } from '@/utils/logger';
import { isStandaloneWebm } from '@/utils/webm';

export class InvalidRecordingRepairAudioError extends Error {
  override readonly name = 'InvalidRecordingRepairAudioError';
}

class RecordingRepairService {
  async process(callId: string, captureId: string): Promise<void> {
    const capture = await recordingRepairStateService.claim(callId, captureId);
    if (!capture) return;

    try {
      const chunks = await gcsService.listRecordingRepairChunks(`recording-repairs/${callId}/${captureId}/`);

      const repairs: Array<{ text: string; timestamp: number }> = [];
      for (const chunk of chunks.sort((left, right) => left.sequence - right.sequence || left.startedAt - right.startedAt)) {
        const buffer = await gcsService.getFileBuffer(chunk.path);
        if (!isStandaloneWebm(buffer)) {
          throw new InvalidRecordingRepairAudioError(
            `Stored recording repair chunk ${chunk.sequence} is a WebM fragment without an EBML header`,
          );
        }
        const result = await voiceInputService.transcribeAudio({
          buffer,
          size: chunk.size,
          mimetype: chunk.mimeType,
          originalname: `${chunk.sequence}.webm`,
        } as Express.Multer.File);
        if (result.text.trim()) repairs.push({ text: result.text, timestamp: chunk.startedAt / 1000 });
      }

      const messageId = await transcriptService.mergeRecordingRepairEntries(
        callId,
        capture.outages.map(outage => ({ startedAt: new Date(outage.startedAt), endedAt: new Date(outage.endedAt) })),
        repairs,
      );

      // Persist the formatted transcript, attachment, call transcript path, and
      // message attachment flag before acknowledging that the repair is merged.
      // Unlike the general summary flow, failures here must keep the repair
      // retryable instead of being swallowed as an optional post-processing step.
      await transcriptService.persistCallTranscript(callId, messageId);
      await recordingRepairStateService.markMerged(callId, captureId);

      // The durable transcript is already visible to clients. Continue optional
      // summary/indexing work without writing the transcript attachment twice.
      await transcriptService.processCallWithSummary(callId, messageId, true, {
        skipTranscriptPersistence: true,
      }).catch(error => {
        logger.error('[RecordingRepairService] Optional post-merge processing failed', {
          callId,
          captureId,
          error,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordingRepairStateService.markFailed(
        callId,
        captureId,
        message,
        !(error instanceof InvalidRecordingRepairAudioError),
      );
      logger.error('[RecordingRepairService] Repair processing failed', { callId, captureId, error });
      throw error;
    }
  }
}

export const recordingRepairService = new RecordingRepairService();
