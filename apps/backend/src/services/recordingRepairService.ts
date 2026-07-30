import { gcsService } from '@/services/gcsService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import { transcriptService } from '@/services/transcriptService';
import { voiceInputService } from '@/services/voiceInputService';
import { logger } from '@/utils/logger';

class RecordingRepairService {
  async process(callId: string, captureId: string): Promise<void> {
    const capture = await recordingRepairStateService.claim(callId, captureId);
    if (!capture) return;

    try {
      const chunks = await gcsService.listRecordingRepairChunks(`recording-repairs/${callId}/${captureId}/`);
      const repairs: Array<{ text: string; timestamp: number }> = [];
      for (const chunk of chunks.sort((left, right) => left.sequence - right.sequence || left.startedAt - right.startedAt)) {
        if (!capture.outages.some(outage => chunk.startedAt < outage.endedAt && chunk.endedAt > outage.startedAt)) continue;
        const buffer = await gcsService.getFileBuffer(chunk.path);
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
      await transcriptService.processCallWithSummary(callId, messageId, true);
      await recordingRepairStateService.markMerged(callId, captureId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordingRepairStateService.markFailed(callId, captureId, message);
      logger.error('[RecordingRepairService] Repair processing failed', { callId, captureId, error });
      throw error;
    }
  }
}

export const recordingRepairService = new RecordingRepairService();
