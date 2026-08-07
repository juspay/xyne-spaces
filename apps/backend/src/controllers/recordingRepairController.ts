import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { CallType } from '@xyne/shared';
import { validate as isUuid } from 'uuid';
import { repositories } from '@/database/repositories';
import { recordingRepairQueue } from '@/queues/recordingRepairQueue';
import {
  recordingRepairStateService,
} from '@/services/recordingRepairStateService';
import {
  outagesAreFullyCovered,
  validateRecordingRepairOutages,
} from '@/services/recordingRepairIntervals';
import {
  recordingRepairStorageService,
  type RecordingRepairChunkMetadata,
  type RecordingRepairChunkInput,
} from '@/services/recordingRepairStorageService';
import { isStandaloneWebm } from '@/utils/webm';
import { logger } from '@/utils/logger';

function normalizeMimeType(value: string | undefined): string | null {
  const normalized = value?.toLowerCase().replace(/\s/g, '');
  return normalized === 'audio/webm' || normalized === 'audio/webm;codecs=opus'
    ? 'audio/webm'
    : null;
}

function sameChunk(left: RecordingRepairChunkMetadata | null, right: RecordingRepairChunkInput): boolean {
  return !!left &&
    left.sequence === right.sequence &&
    left.startedAt === right.startedAt &&
    left.endedAt === right.endedAt &&
    left.sha256 === right.sha256 &&
    left.mimeType === right.mimeType;
}

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

  uploadChunk = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId, sequence: rawSequence } = req.params;
    const file = req.file;
    const sequence = Number(rawSequence);
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isUuid(captureId) || !file || !Number.isSafeInteger(sequence) || sequence < 0) {
      res.status(400).json({ success: false, error: 'Invalid recording repair chunk' });
      return;
    }

    const startedAt = new Date(String(req.body.startedAt ?? '')).getTime();
    const endedAt = new Date(String(req.body.endedAt ?? '')).getTime();
    const checksum = String(req.body.checksum ?? '').toLowerCase();
    const mimeType = normalizeMimeType(String(req.body.mimeType ?? ''));
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(endedAt) ||
      endedAt <= startedAt ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      !mimeType ||
      !normalizeMimeType(file.mimetype) ||
      !isStandaloneWebm(file.buffer)
    ) {
      res.status(400).json({ success: false, error: 'Invalid recording repair metadata or WebM data' });
      return;
    }

    try {
      const authorized = await this.getOwnedHeadlessCall(req, callId);
      if (authorized.error) {
        res.status(authorized.error).json({ success: false, error: authorized.error === 403 ? 'Access denied' : 'Recording not found' });
        return;
      }
      const actualChecksum = createHash('sha256').update(file.buffer).digest('hex');
      if (actualChecksum !== checksum) {
        res.status(400).json({ success: false, error: 'Chunk checksum mismatch' });
        return;
      }

      const input: RecordingRepairChunkInput = { sequence, startedAt, endedAt, sha256: checksum, mimeType };
      const path = recordingRepairStorageService.chunkPath(callId, captureId, sequence);
      const existing = await recordingRepairStorageService.getChunk(path);
      if (existing) {
        if (!sameChunk(existing, input)) {
          res.status(409).json({ success: false, error: 'Chunk sequence already exists with different metadata' });
          return;
        }
        res.json({ success: true, idempotent: true });
        return;
      }

      const capture = await recordingRepairStateService.get(callId, captureId);
      if (capture && capture.status !== 'OPEN') {
        res.status(409).json({ success: false, error: 'Recording repair capture is already finalized' });
        return;
      }
      const result = await recordingRepairStorageService.writeChunkIfAbsent(
        callId,
        captureId,
        file.buffer,
        input,
      );
      if (!result.created && !sameChunk(result.chunk, input)) {
        res.status(409).json({ success: false, error: 'Chunk sequence already exists with different metadata' });
        return;
      }
      res.status(result.created ? 201 : 200).json({ success: true, idempotent: !result.created });
    } catch (error) {
      logger.error('[RecordingRepairController] Chunk upload failed', { callId, captureId, error });
      res.status(500).json({ success: false, error: 'Failed to upload recording repair chunk' });
    }
  };

  finalize = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId } = req.params;
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isUuid(captureId)) {
      res.status(400).json({ success: false, error: 'Invalid capture id' });
      return;
    }
    try {
      const authorized = await this.getOwnedHeadlessCall(req, callId);
      if (authorized.error) {
        res.status(authorized.error).json({ success: false, error: authorized.error === 403 ? 'Access denied' : 'Recording not found' });
        return;
      }
      const outages = validateRecordingRepairOutages((req.body as { outages?: unknown }).outages);
      const existing = await recordingRepairStateService.get(callId, captureId);
      if (existing) {
        if (existing.status === 'FINALIZED' || (existing.status === 'FAILED' && existing.retryable)) {
          await recordingRepairQueue.enqueue(callId, captureId, existing.finalizedAt);
        }
        res.json({ success: true, idempotent: true, status: existing.status });
        return;
      }
      const chunks = await recordingRepairStorageService.listChunks(callId, captureId);
      if (!outagesAreFullyCovered(outages, chunks)) {
        res.status(400).json({ success: false, error: 'Missing recording repair chunks for an outage' });
        return;
      }
      const capture = await recordingRepairStateService.finalize(callId, captureId, outages);
      await recordingRepairQueue.enqueue(callId, captureId, capture.finalizedAt);
      res.json({ success: true, status: capture.status });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes('outage')) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
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
    if (authorized.error) {
      res.status(authorized.error).json({ success: false, error: authorized.error === 403 ? 'Access denied' : 'Recording not found' });
      return;
    }
    const capture = await recordingRepairStateService.get(callId, captureId);
    if (!capture) {
      res.status(404).json({ success: false, error: 'Recording repair capture not found' });
      return;
    }
    res.json({ success: true, capture: { status: capture.status, processingError: capture.processingError } });
  };
}

export const recordingRepairController = new RecordingRepairController();
