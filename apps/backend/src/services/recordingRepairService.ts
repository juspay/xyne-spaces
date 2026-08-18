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

export class RecordingRepairDeferredError extends Error {
  override readonly name = 'RecordingRepairDeferredError';
}

function manifestContentHash(manifest: RecordingCaptureManifest): string {
  return createHash('sha256').update(serializeManifestForHash(manifest)).digest('hex');
}

/**
 * Wall-clock ms → offset (ms) into the reconstructed audio. Each chunk's media
 * duration is its wall-clock span; pause gaps between chunks contribute no media,
 * so summing chunk spans up to `wallMs` excludes paused time.
 */
function wallToMediaMs(chunks: RecordingChunkDescriptor[], wallMs: number): number {
  let media = 0;
  for (const chunk of chunks) {
    if (wallMs >= chunk.endedAtMs) media += chunk.endedAtMs - chunk.startedAtMs;
    else if (wallMs > chunk.startedAtMs) return media + (wallMs - chunk.startedAtMs);
    else break;
  }
  return media;
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

      // Download + verify + concatenate the contiguous prefix into the original WebM.
      const buffers: Buffer[] = [];
      for (const sequence of needed) {
        await heartbeat();
        await assertLease();
        const chunk = manifest.chunks.find((c) => c.sequence === sequence);
        if (!chunk) throw new RecordingRepairTerminalError(`Manifest is missing chunk ${sequence}`);
        const buffer = await recordingRepairStorageService.readChunkPart(callId, captureId, sequence);
        if (buffer.length !== chunk.byteLength) {
          throw new RecordingRepairTerminalError(`Chunk ${sequence} size differs from manifest`);
        }
        if (createHash('sha256').update(buffer).digest('hex') !== chunk.sha256) {
          throw new RecordingRepairTerminalError(`Chunk ${sequence} checksum mismatch`);
        }
        buffers.push(buffer);
      }
      const reconstructed = Buffer.concat(buffers);
      if (!isStandaloneWebm(reconstructed)) {
        throw new RecordingRepairTerminalError('Reconstructed audio has no WebM header');
      }
      const uploadedChunks = manifest.chunks.filter((c) => needed.includes(c.sequence));

      // Windows of the call to transcribe: each outage, or the whole call if offline.
      const windows = manifest.offlineAtStart
        ? [
            {
              startedAtMs: manifest.startedAt,
              endedAtMs: manifest.endedAt ?? uploadedChunks[uploadedChunks.length - 1]!.endedAtMs,
            },
          ]
        : manifest.outages.map((outage) => ({
            startedAtMs: outage.startedAtMs,
            endedAtMs: outage.endedAtMs,
          }));

      const repairs: Array<{
        user: string;
        text: string;
        timestamp: number;
        participant_identity: string;
      }> = [];
      const replacementCoverage: Array<{ startedAt: number; endedAt: number }> = [];

      for (const window of windows) {
        await heartbeat();
        await assertLease();
        const startOffsetMs = wallToMediaMs(uploadedChunks, window.startedAtMs);
        const endOffsetMs = wallToMediaMs(uploadedChunks, window.endedAtMs);
        if (endOffsetMs <= startOffsetMs) continue;
        const result = await voiceInputService.transcribeRecordingRepair(
          {
            buffer: reconstructed,
            size: reconstructed.length,
            mimetype: manifest.mimeType,
            originalname: `${captureId}.webm`,
          } as Express.Multer.File,
          { startOffsetMs, endOffsetMs }
        );
        const requestedSeconds = (endOffsetMs - startOffsetMs) / 1000;
        if (Math.abs(result.audioDurationSeconds - requestedSeconds) > 0.5) {
          throw new RecordingRepairTerminalError('Decoded repair audio duration differs from manifest');
        }
        if (!result.speechDetected) continue;
        const segments =
          result.segments.length > 0
            ? result.segments
            : [{ startSeconds: 0, endSeconds: result.audioDurationSeconds, text: result.text }];
        for (const segment of segments) {
          const text = segment.text.trim();
          if (!text) continue;
          // Within a window (no pause) media time is linear, so map the segment
          // back to the wall-clock transcript timeline off the window start.
          const startedAt = window.startedAtMs + segment.startSeconds * 1000;
          const endedAt = Math.min(window.endedAtMs, window.startedAtMs + segment.endSeconds * 1000);
          if (endedAt <= startedAt) continue;
          repairs.push({ user: 'Recovered audio', text, timestamp: startedAt / 1000, participant_identity: '' });
          replacementCoverage.push({ startedAt, endedAt });
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
