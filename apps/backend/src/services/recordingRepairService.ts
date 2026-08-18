import { createHash } from 'crypto';
import {
  neededChunkSequences,
  serializeManifestForHash,
  validateManifestStructure,
  type RecordingCaptureManifest,
  type RecordingChunkDescriptor,
} from '@xyne/shared';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import { recordingRepairStorageService } from '@/services/recordingRepairStorageService';
import { voiceInputService } from '@/services/voiceInputService';
import { logger } from '@/utils/logger';
import { isStandaloneWebm } from '@/utils/webm';
import { coalesceRecordingRepairCoverage } from '@/services/recordingRepairIntervals';

export class RecordingRepairTerminalError extends Error {
  override readonly name = 'RecordingRepairTerminalError';
}

// Thrown to signal "not yet — retry later"; unlike the terminal error the queue
// never branches on it, so it stays module-local and simply propagates for a retry.
class RecordingRepairDeferredError extends Error {
  override readonly name = 'RecordingRepairDeferredError';
}

function manifestContentHash(manifest: RecordingCaptureManifest): string {
  return createHash('sha256').update(serializeManifestForHash(manifest)).digest('hex');
}

/** Total media (ms) in the recording: the sum of chunk wall-spans (pauses excluded). */
function totalMediaMs(chunks: RecordingChunkDescriptor[]): number {
  return chunks.reduce((sum, chunk) => sum + (chunk.endedAtMs - chunk.startedAtMs), 0);
}

/**
 * Offset (ms) into the decoded audio → wall-clock ms. Each chunk contributes its
 * wall-span of media and pause gaps between chunks contribute none, so we walk the
 * chunks accumulating media until we reach the one containing `mediaMs`. This maps
 * the agent's segment times (measured from the start of the whole recording) back
 * onto the transcript's wall-clock timeline.
 */
function mediaMsToWall(chunks: RecordingChunkDescriptor[], mediaMs: number): number {
  let media = 0;
  for (const chunk of chunks) {
    const span = chunk.endedAtMs - chunk.startedAtMs;
    if (mediaMs <= media + span) return chunk.startedAtMs + (mediaMs - media);
    media += span;
  }
  const last = chunks[chunks.length - 1];
  return last ? last.endedAtMs + (mediaMs - media) : mediaMs;
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
        logger.warn('[RecordingRepairService] Lease heartbeat failed', { callId, captureId, error });
      } finally {
        heartbeatRunning = false;
      }
    };
    const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
    const assertLease = async (): Promise<void> => {
      if (leaseLost) throw new Error('Recording repair lease was lost');
      await recordingRepairStateService.assertLease(callId, captureId, leaseId);
    };

    let merged = false;
    try {
      const manifest = await recordingRepairStorageService.readManifest(callId, captureId);
      if (!manifest) throw new RecordingRepairTerminalError('Recording repair manifest is missing');
      if (capture.manifestHash && manifestContentHash(manifest) !== capture.manifestHash) {
        throw new RecordingRepairTerminalError('Recording repair manifest hash mismatch');
      }
      const structureError = validateManifestStructure(manifest);
      if (structureError) throw new RecordingRepairTerminalError(structureError);

      const needed = neededChunkSequences(manifest);
      if (needed.length === 0) {
        throw new RecordingRepairTerminalError('Manifest has no outage windows to repair');
      }

      // Fetch the whole capture. The client already stitched it into one WebM, so
      // the agent decodes + VAD + STT it as-is — no reconstruction, no trimming.
      await heartbeat();
      await assertLease();
      const audio = await recordingRepairStorageService.readAudio(callId, captureId);
      if (!isStandaloneWebm(audio)) {
        throw new RecordingRepairTerminalError('Uploaded recording has no WebM header');
      }

      // Windows of the call whose transcript may be replaced: each outage, or the
      // whole call when it was offline from the start.
      const windows = manifest.offlineAtStart
        ? [
            {
              startedAtMs: manifest.startedAt,
              endedAtMs:
                manifest.endedAt ??
                manifest.chunks[manifest.chunks.length - 1]?.endedAtMs ??
                manifest.startedAt,
            },
          ]
        : manifest.outages.map((outage) => ({
            startedAtMs: outage.startedAtMs,
            endedAtMs: outage.endedAtMs,
          }));

      const result = await voiceInputService.transcribeRecordingRepair({
        buffer: audio,
        size: audio.length,
        mimetype: manifest.mimeType,
        originalname: `${captureId}.webm`,
      } as Express.Multer.File);
      await heartbeat();
      await assertLease();

      const expectedSeconds = totalMediaMs(manifest.chunks) / 1000;
      if (Math.abs(result.audioDurationSeconds - expectedSeconds) > Math.max(2, expectedSeconds * 0.05)) {
        throw new RecordingRepairTerminalError('Decoded recording duration differs from manifest');
      }

      const repairs: Array<{
        user: string;
        text: string;
        timestamp: number;
        participant_identity: string;
      }> = [];
      const replacementCoverage: Array<{ startedAt: number; endedAt: number }> = [];

      if (result.speechDetected) {
        const segments =
          result.segments.length > 0
            ? result.segments
            : [{ startSeconds: 0, endSeconds: result.audioDurationSeconds, text: result.text }];
        for (const segment of segments) {
          const text = segment.text.trim();
          if (!text) continue;
          // Segment times are measured from the start of the whole recording; map
          // them onto the wall-clock timeline, then keep only the part inside an
          // outage window so good live transcript is never overwritten.
          const segStartWall = mediaMsToWall(manifest.chunks, segment.startSeconds * 1000);
          const segEndWall = mediaMsToWall(manifest.chunks, segment.endSeconds * 1000);
          for (const window of windows) {
            const startedAt = Math.max(segStartWall, window.startedAtMs);
            const endedAt = Math.min(segEndWall, window.endedAtMs);
            if (endedAt <= startedAt) continue;
            repairs.push({ user: 'Recovered audio', text, timestamp: startedAt / 1000, participant_identity: '' });
            replacementCoverage.push({ startedAt, endedAt });
            break;
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
        logger.info('[RecordingRepairService] VAD/STT found no replacement speech', { callId, captureId });
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
      logger.error('[RecordingRepairService] Repair processing failed', { callId, captureId, error });
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
        logger.error('[RecordingRepairService] Artifact refresh recovery failed', { callId, error });
      }
    }
  }

  async cleanupStaleObjects(now = Date.now()): Promise<void> {
    const orphanCutoff = now - 7 * 24 * 60 * 60_000;
    const files = await recordingRepairStorageService.listRepairObjects();
    const groups = new Map<string, { callId: string; captureId: string; paths: string[]; newest: number }>();
    for (const file of files) {
      const match = /^recording-repairs\/([^/]+)\/([^/]+)\//.exec(file.name);
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
    // refreshRecordingArtifacts marks the call's captures artifacts-refreshed on success.
    await noteTakerTranscriptService.refreshRecordingArtifacts(callId);
    for (const captureId of await recordingRepairStateService.listDeletableCaptureIdsForCall(callId)) {
      await recordingRepairStorageService.deleteCaptureObjects(callId, captureId).catch((error) => {
        logger.warn('[RecordingRepairService] Failed to delete repair objects', { callId, captureId, error });
      });
    }
  }
}

export const recordingRepairService = new RecordingRepairService();
