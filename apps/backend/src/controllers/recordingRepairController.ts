import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { CallType } from '@xyne/shared';
import {
  neededChunkSequences,
  serializeManifestForHash,
  validateManifestStructure,
} from '@xyne/shared';
import { validate as isUuid } from 'uuid';
import { repositories } from '@/database/repositories';
import { recordingRepairQueue } from '@/queues/recordingRepairQueue';
import { recordingRepairStateService } from '@/services/recordingRepairStateService';
import { recordingRepairStorageService } from '@/services/recordingRepairStorageService';
import { logger } from '@/utils/logger';

const MAX_UPLOAD_URLS = 5_000;

function manifestContentHash(manifest: Parameters<typeof serializeManifestForHash>[0]): string {
  return createHash('sha256').update(serializeManifestForHash(manifest)).digest('hex');
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

  private sendAuthError(res: Response, error: 401 | 403 | 404): void {
    res.status(error).json({
      success: false,
      error: error === 401 ? 'Unauthorized' : error === 403 ? 'Access denied' : 'Recording not found',
    });
  }

  // Issue short-lived signed PUT URLs so the client uploads chunk parts + the
  // manifest directly to GCS. Authorized by the caller's session + call ownership;
  // no permanent storage credentials ever reach the browser/Electron.
  getUploadUrls = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId } = req.params;
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    const sequences = (req.body as { sequences?: unknown }).sequences;
    if (
      !isUuid(captureId) ||
      !Array.isArray(sequences) ||
      sequences.length > MAX_UPLOAD_URLS ||
      sequences.some((s) => !Number.isSafeInteger(s) || (s as number) < 0)
    ) {
      res.status(400).json({ success: false, error: 'Invalid recording repair upload request' });
      return;
    }
    try {
      const authorized = await this.getOwnedHeadlessCall(req, callId);
      if (authorized.error) return this.sendAuthError(res, authorized.error);

      const existing = await recordingRepairStateService.get(callId, captureId);
      if (existing) {
        res.status(409).json({ success: false, error: 'Recording repair capture is already finalized' });
        return;
      }

      const chunks = await Promise.all(
        (sequences as number[]).map(async (sequence) => ({
          sequence,
          url: await recordingRepairStorageService.chunkUploadUrl(callId, captureId, sequence),
        }))
      );
      const manifestUrl = await recordingRepairStorageService.manifestUploadUrl(callId, captureId);
      res.json({ success: true, chunks, manifestUrl });
    } catch (error) {
      logger.error('[RecordingRepairController] Upload URL generation failed', { callId, captureId, error });
      res.status(500).json({ success: false, error: 'Failed to issue recording repair upload URLs' });
    }
  };

  finalize = async (req: Request, res: Response): Promise<void> => {
    const { callId, captureId } = req.params;
    const manifestHash = String((req.body as { manifestHash?: unknown }).manifestHash ?? '').toLowerCase();
    if (!req.user?.id) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    if (!isUuid(captureId) || !/^[a-f0-9]{64}$/.test(manifestHash)) {
      res.status(400).json({ success: false, error: 'Invalid finalize request' });
      return;
    }
    try {
      const authorized = await this.getOwnedHeadlessCall(req, callId);
      if (authorized.error) return this.sendAuthError(res, authorized.error);

      const existing = await recordingRepairStateService.get(callId, captureId);
      if (existing) {
        if (existing.manifestHash !== manifestHash) {
          res.status(409).json({ success: false, error: 'Capture was finalized with a different manifest' });
          return;
        }
        if (existing.status === 'FINALIZED' || (existing.status === 'FAILED' && existing.retryable)) {
          await recordingRepairQueue.enqueue(callId, captureId, existing.finalizedAt);
        }
        res.json({ success: true, idempotent: true, status: existing.status });
        return;
      }

      const manifest = await recordingRepairStorageService.readManifest(callId, captureId);
      if (!manifest || manifest.callId !== callId || manifest.captureId !== captureId) {
        res.status(400).json({ success: false, error: 'Manifest was not uploaded' });
        return;
      }
      if (manifestContentHash(manifest) !== manifestHash) {
        res.status(400).json({ success: false, error: 'Manifest hash mismatch' });
        return;
      }
      const structureError = validateManifestStructure(manifest);
      if (structureError) {
        res.status(400).json({ success: false, error: structureError });
        return;
      }
      const needed = neededChunkSequences(manifest);
      if (needed.length === 0) {
        res.status(400).json({ success: false, error: 'Manifest has no outage windows to repair' });
        return;
      }
      const uploaded = await recordingRepairStorageService.listUploadedSequences(callId, captureId);
      const missing = needed.filter((sequence) => !uploaded.has(sequence));
      if (missing.length > 0) {
        recordingRepairStorageService.logMissing(callId, captureId, missing);
        res.status(400).json({ success: false, error: 'Missing recording repair chunk parts' });
        return;
      }

      const manifestPath = recordingRepairStorageService.manifestPath(callId, captureId);
      const capture = await recordingRepairStateService.finalize(callId, captureId, manifestPath, manifestHash);
      if (capture.manifestHash !== manifestHash) {
        res.status(409).json({ success: false, error: 'Capture was finalized with a different manifest' });
        return;
      }
      await recordingRepairQueue.enqueue(callId, captureId, capture.finalizedAt);
      res.json({ success: true, status: capture.status });
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
    const capture = await recordingRepairStateService.get(callId, captureId);
    if (!capture) {
      res.status(404).json({ success: false, error: 'Recording repair capture not found' });
      return;
    }
    res.json({
      success: true,
      capture: {
        status: capture.status,
        processingError: capture.processingError,
        retryable: capture.retryable,
      },
    });
  };
}

export const recordingRepairController = new RecordingRepairController();
