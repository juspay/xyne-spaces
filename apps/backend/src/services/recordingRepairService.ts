import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import {
  recordingRepairStorageService,
  type RecordingRepairChunkMetadata,
} from '@/services/recordingRepairStorageService';
import { voiceInputService } from '@/services/voiceInputService';
import { logger } from '@/utils/logger';
import { isStandaloneWebm } from '@/utils/webm';
import { coalesceRecordingRepairCoverage } from '@/services/recordingRepairIntervals';

export class RecordingRepairTerminalError extends Error {
  override readonly name = 'RecordingRepairTerminalError';
}

export class RecordingRepairDeferredError extends Error {
  override readonly name = 'RecordingRepairDeferredError';
}

export class RecordingRepairService {
  async process(callId: string, captureId: string): Promise<void> {
    if (!(await recordingRepairStateService.isLiveTranscriptFinalized(callId))) {
      throw new RecordingRepairDeferredError('Live transcript has not been finalized yet');
    }
    const capture = await recordingRepairStateService.claim(callId, captureId);
    if (!capture) return;
    const leaseId = capture.leaseId;
    if (!leaseId) throw new Error('Recording repair claim did not return a lease');

    let leaseLost = false;
    let heartbeatRunning = false;
    const heartbeat = async (): Promise<void> => {
      if (heartbeatRunning || leaseLost) return;
      heartbeatRunning = true;
      try {
        leaseLost = !(await recordingRepairStateService.heartbeat(callId, captureId, leaseId));
      } catch (error) {
        leaseLost = true;
        logger.warn('[RecordingRepairService] Lease heartbeat failed', {
          callId,
          captureId,
          error,
        });
      } finally {
        heartbeatRunning = false;
      }
    };
    const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
    const assertLease = async (): Promise<void> => {
      if (leaseLost) throw new Error('Recording repair lease was lost');
      await recordingRepairStateService.assertLease(callId, captureId, leaseId);
    };

    let chunks: RecordingRepairChunkMetadata[] = [];
    let merged = false;
    try {
      chunks = await recordingRepairStorageService.listChunks(callId, captureId);
      const selected = chunks.filter((chunk) =>
        capture.outages.some(
          (outage) => chunk.startedAt < outage.endedAt && chunk.endedAt > outage.startedAt
        )
      );
      if (selected.length === 0) {
        throw new RecordingRepairTerminalError('No repair chunks overlap the finalized outages');
      }

      const repairs: Array<{
        user: string;
        text: string;
        timestamp: number;
        participant_identity: string;
      }> = [];
      const replacementCoverage: Array<{ startedAt: number; endedAt: number }> = [];
      for (const chunk of selected) {
        await heartbeat();
        await assertLease();
        const buffer = await recordingRepairStorageService.readChunk(chunk.path);
        if (!isStandaloneWebm(buffer)) {
          throw new RecordingRepairTerminalError(
            `Stored recording repair chunk ${chunk.sequence} has no standalone WebM header`
          );
        }
        const file = {
          buffer,
          size: chunk.size,
          mimetype: chunk.mimeType,
          originalname: `${chunk.sequence}.webm`,
        } as Express.Multer.File;
        const intersections = coalesceRecordingRepairCoverage(
          capture.outages
            .map((outage) => ({
              startedAt: Math.max(chunk.startedAt, outage.startedAt),
              endedAt: Math.min(chunk.endedAt, outage.endedAt),
            }))
            .filter((interval) => interval.endedAt > interval.startedAt)
        );

        for (const interval of intersections) {
          await heartbeat();
          await assertLease();
          const result = await voiceInputService.transcribeRecordingRepair(file, {
            startOffsetMs: interval.startedAt - chunk.startedAt,
            endOffsetMs: interval.endedAt - chunk.startedAt,
          });
          const requestedDurationSeconds = (interval.endedAt - interval.startedAt) / 1000;
          if (Math.abs(result.audioDurationSeconds - requestedDurationSeconds) > 0.5) {
            throw new RecordingRepairTerminalError(
              `Decoded repair audio duration differs from metadata for chunk ${chunk.sequence}`
            );
          }
          if (!result.speechDetected) continue;
          const segments =
            result.segments.length > 0
              ? result.segments
              : [
                  {
                    startSeconds: 0,
                    endSeconds: result.audioDurationSeconds,
                    text: result.text,
                  },
                ];
          for (const segment of segments) {
            const text = segment.text.trim();
            if (!text) continue;
            const startedAt = interval.startedAt + segment.startSeconds * 1000;
            const endedAt = Math.min(
              interval.endedAt,
              interval.startedAt + segment.endSeconds * 1000
            );
            if (endedAt <= startedAt) continue;
            repairs.push({
              user: 'Recovered audio',
              text,
              timestamp: startedAt / 1000,
              participant_identity: '',
            });
            replacementCoverage.push({ startedAt, endedAt });
          }
        }
      }

      if (repairs.length > 0) {
        await assertLease();
        await noteTakerTranscriptService.applyRecordingRepair(
          callId,
          repairs,
          coalesceRecordingRepairCoverage(replacementCoverage),
          () => recordingRepairStateService.assertLease(callId, captureId, leaseId)
        );
      } else {
        logger.info('[RecordingRepairService] VAD/STT found no replacement speech', {
          callId,
          captureId,
        });
      }
      await recordingRepairStateService.markMerged(callId, captureId, leaseId);
      merged = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failure =
        error instanceof RecordingRepairTerminalError || message === 'Headless recording not found'
          ? error instanceof RecordingRepairTerminalError
            ? error
            : new RecordingRepairTerminalError(message)
          : error;
      try {
        await recordingRepairStateService.markFailed(
          callId,
          captureId,
          message,
          leaseId,
          !(failure instanceof RecordingRepairTerminalError)
        );
      } catch (markError) {
        logger.warn('[RecordingRepairService] Did not overwrite state after lease loss', {
          callId,
          captureId,
          markError,
        });
      }
      logger.error('[RecordingRepairService] Repair processing failed', {
        callId,
        captureId,
        error,
      });
      throw failure;
    } finally {
      clearInterval(heartbeatTimer);
    }

    if (merged && !(await recordingRepairStateService.hasUnmergedForCall(callId))) {
      await this.refreshArtifactsForCall(callId);
    }
  }

  async recoverPendingArtifacts(): Promise<void> {
    for (const callId of await recordingRepairStateService.findCallsNeedingArtifactRefresh()) {
      try {
        await this.refreshArtifactsForCall(callId);
      } catch (error) {
        logger.error('[RecordingRepairService] Artifact refresh recovery failed', {
          callId,
          error,
        });
      }
    }
  }

  async cleanupStaleObjects(now = Date.now()): Promise<void> {
    const orphanCutoff = now - 7 * 24 * 60 * 60_000;
    const files = await recordingRepairStorageService.listRepairObjects();
    const groups = new Map<
      string,
      { callId: string; captureId: string; paths: string[]; newest: number }
    >();
    for (const file of files) {
      const match = /^recording-repairs\/([^/]+)\/([^/]+)\/[^/]+\.webm$/.exec(file.name);
      if (!match) continue;
      const [, callId, captureId] = match;
      if (!callId || !captureId) continue;
      const key = `${callId}:${captureId}`;
      const group = groups.get(key) ?? { callId, captureId, paths: [], newest: 0 };
      group.paths.push(file.name);
      group.newest = Math.max(group.newest, file.updated?.getTime() ?? now);
      groups.set(key, group);
    }

    const candidates = [...groups.values()].sort((left, right) => left.newest - right.newest);
    let deletedGroups = 0;
    for (const group of candidates) {
      const state = await recordingRepairStateService.get(group.callId, group.captureId);
      const staleOrphan = !state && group.newest < orphanCutoff;
      const safelyCompleted =
        (state?.status === 'MERGED' && state.artifactsRefreshed) ||
        (state?.status === 'FAILED' && !state.retryable);
      if (staleOrphan || safelyCompleted) {
        await recordingRepairStorageService.deletePaths(group.paths);
        logger.info('[RecordingRepairService] Removed stale repair objects', {
          callId: group.callId,
          captureId: group.captureId,
          count: group.paths.length,
          reason: safelyCompleted ? 'completed' : 'orphaned',
        });
        deletedGroups += 1;
        if (deletedGroups >= 500) break;
      }
    }
  }

  private async refreshArtifactsForCall(callId: string): Promise<void> {
    await noteTakerTranscriptService.refreshRecordingArtifacts(callId);
    for (const captureId of await recordingRepairStateService.listDeletableCaptureIdsForCall(
      callId
    )) {
      const chunks = await recordingRepairStorageService.listChunks(callId, captureId);
      if (chunks.length > 0) await recordingRepairStorageService.deleteChunks(chunks);
    }
  }
}

export const recordingRepairService = new RecordingRepairService();
