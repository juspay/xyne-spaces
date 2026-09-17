import type { Request, Response } from 'express';
import { CallType } from '@xyne/shared';
import { validate as isUuid } from 'uuid';
import { repositories } from '@/database/repositories';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { recordingRepairStorageService } from '@/services/recordingRepairStorageService';
import { acquireLock, releaseLock, renewLock, type LockHandle } from '@/utils/distributedLock';
import { logger } from '@/utils/logger';

// A whole-call recording.webm streamed through the backend. Long calls are large,
// so the body is piped straight to storage (never buffered); this bound only
// rejects absurd Content-Lengths up front.
const MAX_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;

// One redo per call at a time: a repeated finalize (client retry, double click on
// the manual trigger) must not pay for a second whole-file STT pass.
const REDO_LOCK_TTL_SECONDS = 120;
const REDO_LOCK_RENEW_MS = 40_000;

class RecordingRepairController {
  private async getOwnedHeadlessCall(req: Request, callId: string) {
    const userId = req.user?.id;
    const workspaceId = req.user?.workspaceId;
    if (!userId || !workspaceId) return { error: 401 as const, call: null };
    const call = await repositories.calls.findByExternalId(callId);
    if (!call || call.callType !== CallType.HEADLESS || call.workspaceId !== workspaceId) {
      return { error: 404 as const, call: null };
    }
    if (call.createdByUserId !== userId) return { error: 403 as const, call: null };
    return { error: null, call };
  }

  private sendAuthError(res: Response, error: 401 | 403 | 404): void {
    res.status(error).json({
      success: false,
      error: error === 401 ? 'Unauthorized' : error === 403 ? 'Access denied' : 'Recording not found',
    });
  }

  private getMetadata(call: { metadata: unknown }): Record<string, unknown> {
    return call.metadata && typeof call.metadata === 'object' && !Array.isArray(call.metadata)
      ? (call.metadata as Record<string, unknown>)
      : {};
  }

  private isRedone(call: { metadata: unknown }): boolean {
    return typeof this.getMetadata(call).localRedoneAt === 'number';
  }

  private redoError(call: { metadata: unknown }): string | null {
    const error = this.getMetadata(call).localRedoError;
    return typeof error === 'string' ? error : null;
  }

  private async runRedo(
    call: Parameters<typeof noteTakerTranscriptService.redoTranscriptFromLocalAudio>[0],
    captureId: string,
    lock: LockHandle
  ): Promise<void> {
    const callId = call.externalId;
    const renewal = setInterval(() => {
      void renewLock(lock, REDO_LOCK_TTL_SECONDS).catch(() => undefined);
    }, REDO_LOCK_RENEW_MS);
    try {
      await noteTakerTranscriptService.redoTranscriptFromLocalAudio(call, captureId);
    } catch (error) {
      logger.error('[RecordingRepairController] Redo failed', { callId, captureId, error });
      await noteTakerTranscriptService
        .setRedoError(callId, 'Re-transcription failed')
        .catch(() => undefined);
    } finally {
      clearInterval(renewal);
      await releaseLock(lock).catch(() => undefined);
    }
  }

  // Stream the whole capture (one recording.webm) through the backend to GCS. The
  // request body is piped straight to storage — never buffered — so long calls do
  // not sit in memory. Overwriting is fine: a client retry re-uploads the same file.
  uploadAudio = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId } = req.params;
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isUuid(captureId)) {
      res.status(400).json({ success: false, error: 'Invalid recording repair upload request' });
      return;
    }
    const contentLength = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_AUDIO_BYTES) {
      res.status(413).json({ success: false, error: 'Recording is too large' });
      return;
    }
    try {
      const authorized = await this.getOwnedHeadlessCall(req, callId);
      if (authorized.error) return this.sendAuthError(res, authorized.error);

      await recordingRepairStorageService.writeAudioStream(callId, captureId, req);
      res.json({ success: true });
    } catch (error) {
      logger.error('[RecordingRepairController] Audio upload failed', { callId, captureId, error });
      res.status(500).json({ success: false, error: 'Failed to upload recording audio' });
    }
  };

  // Trigger the whole-file redo: re-transcribe the uploaded recording.webm, overwrite
  // the canonical transcript, reprocess, and serve the local audio. The redo runs off
  // the request (it does slow STT + LLM work); the client polls getStatus until the
  // Call's completion marker lands. Re-running is idempotent, so a client retry after
  // a crashed redo simply completes it.
  finalize = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId } = req.params;
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isUuid(captureId)) {
      res.status(400).json({ success: false, error: 'Invalid finalize request' });
      return;
    }
    try {
      const authorized = await this.getOwnedHeadlessCall(req, callId);
      if (authorized.error) return this.sendAuthError(res, authorized.error);
      const call = authorized.call;

      if (this.isRedone(call)) {
        res.json({ success: true, done: true });
        return;
      }
      if (!(await recordingRepairStorageService.audioExists(callId, captureId))) {
        res.status(400).json({ success: false, error: 'Recording audio was not uploaded' });
        return;
      }

      const lock = await acquireLock(`lock:recording-redo:${callId}`, {
        ttlSeconds: REDO_LOCK_TTL_SECONDS,
      });
      if (!lock) {
        // A redo for this call is already running; the client just keeps polling.
        res.json({ success: true, done: false });
        return;
      }
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'automatic';
      logger.info(`[${callId}] recording_redo_started`, { captureId, reason });
      // Clear the previous attempt's failure before responding so the client's first
      // poll cannot read a stale one.
      await noteTakerTranscriptService.setRedoError(callId, null).catch(() => undefined);

      // Fire-and-forget: the redo can take minutes (whole-file STT + summary), far
      // longer than an HTTP request should be held open. The client polls getStatus.
      void this.runRedo(call, captureId, lock);
      res.json({ success: true, done: false });
    } catch (error) {
      logger.error('[RecordingRepairController] Finalize failed', { callId, captureId, error });
      res.status(500).json({ success: false, error: 'Failed to finalize recording repair' });
    }
  };

  getStatus = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId } = req.params;
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isUuid(captureId)) {
      res.status(400).json({ success: false, error: 'Invalid capture id' });
      return;
    }
    const authorized = await this.getOwnedHeadlessCall(req, callId);
    if (authorized.error) return this.sendAuthError(res, authorized.error);
    const done = this.isRedone(authorized.call);
    const error = done ? null : this.redoError(authorized.call);
    res.json({ success: true, capture: { done, failed: error !== null, error } });
  };
}

export const recordingRepairController = new RecordingRepairController();
