import { EgressClient, EgressStatus, SegmentedFileOutput, SegmentedFileProtocol, GCPUpload, S3Upload, EgressInfo } from 'livekit-server-sdk';
import { type Call, type CallRecording } from '@prisma/client';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { config } from '@/config/env';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { livekitService } from '@/services/liveKitService';
import { stitchHlsToMp4 } from '@/utils/ffmpeg';
import { unifiedBotUserService } from '@/bots/unified/services/unified-bot-user-service.js';
import { MessageType, AttachmentEntityType, CallType, RecordingType } from '@xyne/shared';

/** HLS segment length. Smaller = more frequent uploads (less data lost on crash). */
const SEGMENT_DURATION_SECONDS = 6;

/**
 * Normalize a thrown value into a compact, structured failure descriptor so every
 * egress/consolidation failure log carries a consistent, greppable `reason` plus
 * the underlying error name/code/message. Logging-only; never throws.
 */
function describeError(error: unknown): { reason: string; message: string; name?: string; code?: string; stack?: string } {
  if (error instanceof Error) {
    const name = error.name;
    const rawCode = (error as { code?: string | number }).code;
    const code = rawCode !== undefined && rawCode !== null ? String(rawCode) : undefined;
    const msg = error.message || '';
    const hay = `${name} ${msg} ${code ?? ''}`.toLowerCase();
    let reason = 'error';
    if (hay.includes('timeout') || hay.includes('timed out') || hay.includes('aborted')) reason = 'timeout';
    else if (hay.includes('econnrefused') || hay.includes('enotfound') || hay.includes('econnreset') || hay.includes('network') || hay.includes('socket')) reason = 'network';
    else if (code) reason = code;
    return { reason, message: msg, name, code, stack: error.stack };
  }
  return { reason: 'non_error_throw', message: typeof error === 'string' ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })() };
}

export interface StartRecordingResult {
  recording: CallRecording;
  /** true when an ACTIVE recording already existed — no new egress was started (C3). */
  alreadyActive: boolean;
}

/**
 * In-call recording, backed by the `call_recordings` table (1 row per session).
 * The table is the single source of truth — the in-memory map below is only a
 * fast-path cache; egressId is always read back from the row. See
 * docs/call_recording_tech_review.md.
 */
class CallRecordingService {
  private egressClient: EgressClient;
  /** Optional fast-path cache of recordingId → egressId. The row is authoritative. */
  private activeEgress = new Map<string, string>();

  private get storageService() {
    return getStorageService(config.gcs.transcriptionBucketName);
  }

  constructor() {
    this.egressClient = new EgressClient(
      config.livekit.url,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );
  }

  getRetentionDays(): number {
    return config.callRecording.retentionDays;
  }

  isRecordingEnabled(): boolean {
    return config.callRecording.enabled;
  }

  /**
   * All GCS keys for one recording, keyed on the recording's own id so two
   * recordings in the same call never collide (C1). HLS segments live in a
   * per-recording dir; the stitched MP4 sits beside it at the same path
   * recordings used before, so every consumer that reads `storagePath` is
   * unchanged.
   */
  private buildPaths(callExternalId: string, recordingId: string) {
    const dir = `recordings/${callExternalId}/${recordingId}`;
    return {
      mp4Path: `${dir}.mp4`,
      segmentPrefix: `${dir}/`,
      filenamePrefix: `${dir}/segment`,
      playlistPath: `${dir}/index.m3u8`,
    };
  }

  private buildUploadOutput() {
    return config.fileStorage.provider === 's3'
      ? {
          case: 's3' as const,
          value: new S3Upload({
            bucket: config.gcs.transcriptionBucketName,
            region: config.s3.region,
            accessKey: config.s3.accessKeyId,
            secret: config.s3.secretAccessKey,
            ...((config.s3.endpoint) ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
          }),
        }
      : {
          case: 'gcp' as const,
          value: new GCPUpload({
            bucket: config.gcs.transcriptionBucketName,
          }),
        };
  }

  /**
   * Start a recording for a call. Any participant may call this. The DB partial
   * unique index enforces a single ACTIVE recording per call: the insert IS the
   * lock. Concurrent starts return the existing recording (alreadyActive=true)
   * instead of starting a second egress.
   *
   * Sequence: insert ACTIVE row → set per-recording storagePath → startEgress →
   * patch egressId. If egress fails to start the row is moved to RECORDING_FAILED
   * so the lock is freed immediately.
   */
  async startRecording(params: {
    call: Call;
    recordingType: RecordingType;
    startedBy: string;
    name?: string | null;
  }): Promise<StartRecordingResult | null> {
    const { call, recordingType, startedBy, name } = params;

    const { recording, created } = await repositories.callRecordings.startActive({
      callId: call.id,
      recordingType,
      startedBy,
      name: name ?? null,
    });

    // Single-active lock already held by another recording — idempotent no-op.
    if (!created) {
      logger.info('[CallRecording] egress_start_skipped', {
        reason: 'already_active',
        callExternalId: call.externalId,
        callId: call.id,
        recordingId: recording.id,
        recordingType,
        startedBy,
        activeStatus: recording.status,
        activeEgressId: recording.egressId ?? null,
      });
      return { recording, alreadyActive: true };
    }

    const paths = this.buildPaths(call.externalId, recording.id);
    await repositories.callRecordings.setSegmentPrefix(recording.id, paths.segmentPrefix);

    try {
      const output = new SegmentedFileOutput({
        protocol: SegmentedFileProtocol.HLS_PROTOCOL,
        filenamePrefix: paths.filenamePrefix,
        playlistName: paths.playlistPath,
        segmentDuration: SEGMENT_DURATION_SECONDS,
        output: this.buildUploadOutput(),
      });

      let info: EgressInfo;
      if (recordingType === RecordingType.AUDIO_ONLY) {
        info = await this.egressClient.startRoomCompositeEgress(call.externalId, output, {
          audioOnly: true,
        });
      } else {
        // AUDIO_SCREEN: speaker-dark keeps the active screen-share large.
        // AUDIO_VIDEO: grid-dark shows all camera tiles equally.
        const layout = recordingType === RecordingType.AUDIO_SCREEN ? 'speaker-dark' : 'grid-dark';
        info = await this.egressClient.startRoomCompositeEgress(call.externalId, output, {
          layout,
          audioOnly: false,
        });
      }

      this.activeEgress.set(recording.id, info.egressId);
      await repositories.callRecordings.setEgressId(recording.id, info.egressId);

      logger.info(`[CallRecording] Started ${recordingType} HLS egress for call ${call.externalId}, recordingId=${recording.id}, egressId=${info.egressId}, segments=${paths.segmentPrefix}`);
      const withEgress = { ...recording, egressId: info.egressId, segmentPrefix: paths.segmentPrefix };

      // Publish active-recording state to room metadata so all clients (incl. late
      // joiners) show the indicator (H4). Non-blocking; the DB row is authoritative.
      const starter = await repositories.users.findById(startedBy).catch(() => null);
      void livekitService.setRecordingState(call.externalId, {
        recordingId: recording.id,
        startedBy,
        startedByName: starter?.name ?? null,
        startedAt: new Date(recording.startedAt).getTime(),
        recordingType: recording.recordingType,
      });

      return { recording: withEgress, alreadyActive: false };
    } catch (error) {
      // Free the single-active lock so the call is immediately recordable again (H1).
      const failure = describeError(error);
      logger.error('[CallRecording] egress_start_failed', {
        reason: failure.reason,
        callExternalId: call.externalId,
        callId: call.id,
        recordingId: recording.id,
        recordingType,
        startedBy,
        segmentPrefix: paths.segmentPrefix,
        errorName: failure.name,
        errorCode: failure.code,
        error: failure.message,
        stack: failure.stack,
      });
      await repositories.callRecordings.markRecordingFailed(recording.id).catch((e) =>
        logger.error(`[CallRecording] failed to mark recording ${recording.id} RECORDING_FAILED:`, e));
      return null;
    }
  }

  /**
   * Stop a specific recording. Moves ACTIVE → STOPPED (freeing the lock) and asks
   * the egress worker to flush + upload; the egress_ended webhook finalises it.
   * Authorization (starter-only) is enforced in the controller.
   */
  async stopRecording(recording: CallRecording): Promise<void> {
    await repositories.callRecordings.markStopped(recording.id);
    await this.stopEgress(recording);

    // Clear the active-recording indicator on every stop path (HTTP stop, call-end).
    // The egress_ended webhook still finalizes the file. Non-blocking; row is authoritative.
    const call = await repositories.calls.findById(recording.callId);
    if (call) void livekitService.setRecordingState(call.externalId, null);
  }

  /**
   * Stop the ACTIVE recording for a call (looked up by externalId / room name).
   * Used when the call ends so egress can flush to storage before the room tears
   * down (LiveKit also auto-ends egress, but this triggers a graceful stop).
   */
  async stopActiveRecordingsForCall(callExternalId: string): Promise<void> {
    const call = await repositories.calls.findByExternalId(callExternalId);
    if (!call) return;
    const active = await repositories.callRecordings.findActiveByCallId(call.id);
    if (!active) return;
    await this.stopRecording(active);
  }

  /** Tell the egress worker to stop, if it is still running. */
  private async stopEgress(recording: CallRecording): Promise<void> {
    let egressId = this.activeEgress.get(recording.id) ?? recording.egressId ?? undefined;
    if (!egressId) {
      logger.warn('[CallRecording] egress_tracking_lost', { recording: recording.id, call: recording.callId, reason: 'no_egressId_on_row' });
      return;
    }
    this.activeEgress.delete(recording.id);
    try {
      const [egressInfo] = await this.egressClient.listEgress({ egressId });
      const stoppable =
        egressInfo?.status === EgressStatus.EGRESS_STARTING ||
        egressInfo?.status === EgressStatus.EGRESS_ACTIVE;
      if (!stoppable) {
        const statusName = egressInfo ? (EgressStatus[egressInfo.status] ?? egressInfo.status) : 'unknown';
        logger.info(`[CallRecording] Egress ${egressId} already in terminal state ${statusName}, skipping stop`);
        return;
      }
      await this.egressClient.stopEgress(egressId);
      logger.info(`[CallRecording] Gracefully stopped egress ${egressId} for recording ${recording.id}`);
    } catch (err) {
      logger.error(`[CallRecording] Failed to stop egress ${egressId} for recording ${recording.id}:`, err);
    }
  }

  /**
   * Retry fileExists with exponential backoff to handle the race between the
   * egress_ended webhook arriving and GCS propagation completing.
   * Attempts: 1s → 4s → 16s → 64s → 256s (341s total max wait)
   */
  private async waitForFileExists(path: string, maxAttempts = 5, initialDelayMs = 1000): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const exists = await this.storageService.fileExists(path);
        if (exists) return true;
      } catch (err) {
        logger.warn(`[CallRecording] fileExists check threw on attempt ${attempt} for ${path}: ${err}`);
      }
      if (attempt < maxAttempts) {
        const delay = initialDelayMs * Math.pow(4, attempt - 1);
        logger.info(`[CallRecording] File not yet available at ${path}, retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  /**
   * Handle the egress_ended webhook, correlated by egressId (C2). Egress now
   * produces HLS segments, so this moves the row to PROCESSING and enqueues the
   * stitch job rather than finalising directly. Even on egress failure we salvage
   * a partial recording if any segments landed; only a truly empty recording
   * moves to UPLOAD_FAILED (freeing the lock).
   */
  async handleEgressEnded(
    egressId: string,
    completedSuccessfully: boolean,
    context: { statusName?: string; egressError?: string | null } = {},
  ): Promise<void> {
    const { statusName, egressError } = context;
    const recording = await repositories.callRecordings.findByEgressId(egressId);
    if (!recording) {
      logger.warn('[CallRecording] egress_ended_no_recording', {
        egressId,
        reason: 'no_row_for_egressId',
        completedSuccessfully,
        egressStatus: statusName,
        egressError: egressError ?? undefined,
      });
      return;
    }
    // activeEgress is keyed by recording.id — delete by that, not egressId, or the entry leaks.
    this.activeEgress.delete(recording.id);

    // Only rows still awaiting egress act on this; anything else is a redelivery.
    if (recording.status !== 'RECORDING_ACTIVE' && recording.status !== 'RECORDING_STOPPED') {
      logger.info('[CallRecording] egress_ended_ignored', {
        recording: recording.id,
        egressId,
        reason: 'redelivery_or_terminal_state',
        currentStatus: recording.status,
        completedSuccessfully,
        egressStatus: statusName,
      });
      return;
    }

    // Egress ended in a failed terminal state after starting. We still try to salvage
    // any HLS segments that landed before the failure; only a truly empty recording
    // is unrecoverable.
    if (!completedSuccessfully) {
      logger.warn('[CallRecording] egress_failed_after_start', {
        recording: recording.id,
        callId: recording.callId,
        egressId,
        reason: 'egress_terminal_not_complete',
        egressStatus: statusName,
        egressError: egressError ?? undefined,
      });
    }

    if (!(await this.hasSegments(recording.segmentPrefix))) {
      await repositories.callRecordings.markUploadFailed(recording.id);
      logger.warn('[CallRecording] egress_consolidation_failed', {
        recording: recording.id,
        callId: recording.callId,
        egressId,
        completedSuccessfully,
        segmentPrefix: recording.segmentPrefix,
        egressStatus: statusName,
        egressError: egressError ?? undefined,
        reason: completedSuccessfully ? 'no_segments_despite_success' : 'egress_failed_no_segments',
      });
      return;
    }

    if (!completedSuccessfully) {
      logger.info('[CallRecording] egress_partial_salvage', {
        recording: recording.id,
        egressId,
        reason: 'segments_present_after_failed_egress',
      });
    }

    await repositories.callRecordings.markProcessing(recording.id);
    const { recordingStitchQueue } = await import('@/queues/recordingStitchQueue');
    await recordingStitchQueue.enqueue(recording.id);
    logger.info('[CallRecording] egress_ended_stitch_enqueued', {
      recording: recording.id,
      egressId,
      completedSuccessfully,
      segmentPrefix: recording.segmentPrefix,
    });
  }

  /**
   * Stitch a recording's HLS segments into a single MP4 (called by the stitch
   * queue). Downloads the playlist + segments, remuxes with ffmpeg, uploads the
   * MP4, marks UPLOADED, deletes the segments, then posts the thread message.
   * Throws on a stitch/upload failure (after marking PROCESSING_FAILED) so the
   * queue retries; message posting is best-effort and never reverts the upload.
   */
  async stitchRecording(recordingId: string): Promise<void> {
    const recording = await repositories.callRecordings.findById(recordingId);
    if (!recording) {
      logger.warn('[CallRecording] stitch_no_recording', { recordingId });
      return;
    }
    if (recording.status !== 'PROCESSING_RECORDING' && recording.status !== 'PROCESSING_FAILED') {
      logger.info(`[CallRecording] stitch skipped — recording ${recordingId} in state ${recording.status}`);
      return;
    }
    const call = await repositories.calls.findById(recording.callId);
    if (!call || !recording.segmentPrefix) {
      await repositories.callRecordings.markProcessingFailed(recordingId);
      logger.error('[CallRecording] stitch_missing_context', { recordingId, hasCall: !!call, segmentPrefix: recording.segmentPrefix });
      return;
    }

    const paths = this.buildPaths(call.externalId, recordingId);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), `rec-${recordingId}-`));
    // Track the consolidation stage so a failure log pinpoints where it broke.
    let stage: 'download_segments' | 'stitch_mp4' | 'upload_mp4' | 'verify_mp4' | 'mark_uploaded' | 'delete_segments' = 'download_segments';
    logger.info('[CallRecording] consolidation_started', {
      recording: recordingId,
      callExternalId: call.externalId,
      segmentPrefix: recording.segmentPrefix,
    });
    try {
      stage = 'download_segments';
      await this.downloadSegments(recording.segmentPrefix, workDir);
      const localOut = path.join(workDir, 'out.mp4');
      stage = 'stitch_mp4';
      await stitchHlsToMp4(path.join(workDir, path.basename(paths.playlistPath)), localOut);

      const mimetype = recording.recordingType === RecordingType.AUDIO_ONLY ? 'audio/mp4' : 'video/mp4';
      const buffer = await fs.readFile(localOut);
      stage = 'upload_mp4';
      await this.storageService.uploadFileV2(buffer, { path: paths.mp4Path, contentType: mimetype });
      stage = 'verify_mp4';
      if (!(await this.waitForFileExists(paths.mp4Path))) {
        throw new Error(`stitched MP4 not found at ${paths.mp4Path}`);
      }

      stage = 'mark_uploaded';
      await repositories.callRecordings.markUploaded(recordingId, { storagePath: paths.mp4Path });
      logger.info('[CallRecording] consolidation_uploaded', {
        recording: recordingId,
        callExternalId: call.externalId,
        path: paths.mp4Path,
      });
      stage = 'delete_segments';
      await this.deleteSegments(recording.segmentPrefix);

      // NOTE_TAKER (headless) calls never create messages/attachments — the
      // call_recordings row (storagePath, status=UPLOADED) is the only record
      // of the file; getRecordingDetail/download-recording already read from
      // this table directly, so there's nothing further to post.
      if (call.callType === CallType.HEADLESS) {
        logger.info(`[CallRecording] Skipping message/attachment post for HEADLESS call ${call.externalId} (recording ${recordingId})`);
      } else {
        try {
          await this.postRecordingMessageAndAttachment(call, { ...recording, storagePath: paths.mp4Path });
        } catch (err) {
          logger.error(`[CallRecording] Failed to post recording message/attachment for recording ${recordingId}:`, err);
        }
      }
    } catch (err) {
      await repositories.callRecordings.markProcessingFailed(recordingId).catch(() => {});
      const failure = describeError(err);
      logger.error('[CallRecording] consolidation_failed', {
        recording: recordingId,
        callExternalId: call.externalId,
        stage,
        reason: failure.reason,
        segmentPrefix: recording.segmentPrefix,
        errorName: failure.name,
        errorCode: failure.code,
        error: failure.message,
        stack: failure.stack,
      });
      throw err;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** True if any HLS object landed under the prefix (segments or playlist). */
  private async hasSegments(segmentPrefix: string | null): Promise<boolean> {
    if (!segmentPrefix) return false;
    try {
      const files = await this.storageService.listFiles(segmentPrefix);
      return files.length > 0;
    } catch (err) {
      logger.warn(`[CallRecording] listFiles failed for ${segmentPrefix}: ${err}`);
      return false;
    }
  }

  /** Download every object under the HLS prefix into a flat local dir (by basename). */
  private async downloadSegments(segmentPrefix: string, destDir: string): Promise<void> {
    const files = await this.storageService.listFiles(segmentPrefix);
    if (files.length === 0) throw new Error(`no segments under ${segmentPrefix}`);
    await Promise.all(files.map(async (f) => {
      const buffer = await this.storageService.getFileBuffer(f.name);
      await fs.writeFile(path.join(destDir, path.basename(f.name)), buffer);
    }));
  }

  /** Remove all HLS segments + playlist once the MP4 is safely stored. */
  private async deleteSegments(segmentPrefix: string): Promise<void> {
    try {
      const files = await this.storageService.listFiles(segmentPrefix);
      await Promise.all(files.map((f) => this.storageService.deleteFile(f.name).catch((e) =>
        logger.warn(`[CallRecording] failed to delete segment ${f.name}: ${e}`))));
    } catch (err) {
      logger.warn(`[CallRecording] deleteSegments failed for ${segmentPrefix}: ${err}`);
    }
  }

  /**
   * Post one thread message per recording (M3), carrying its own attachment.
   * The attachment metadata uses the 'recording' discriminator and carries
   * recordingId so cleanup can target exactly this recording.
   */
  private async postRecordingMessageAndAttachment(call: Call, recording: CallRecording): Promise<void> {
    const headMessage = await repositories.messages.findHeadMessageByCallId(call.externalId);
    if (!headMessage) {
      logger.warn('[CallRecording] recording_message_skipped', { recording: recording.id, reason: 'head_message_not_found' });
      return;
    }

    const callCreator = await repositories.users.findById(call.createdByUserId);
    if (!callCreator?.workspaceId) {
      logger.warn('[CallRecording] recording_message_skipped', { recording: recording.id, reason: 'workspace_not_found' });
      return;
    }
    const workspaceId = callCreator.workspaceId;

    const bot = await unifiedBotUserService.getBotByBotId('xyne-automatic', workspaceId);
    const senderId = bot?.id ?? call.createdByUserId;

    const isAudio = recording.recordingType === RecordingType.AUDIO_ONLY;
    const mimetype = isAudio ? 'audio/mp4' : 'video/mp4';
    const recordingName = recording.name?.trim() || 'Recording';
    const displayFilename = call.title ? `${call.title} - ${recordingName}.mp4` : `${recordingName}.mp4`;

    // Post the per-recording thread message first so the attachment hangs off it.
    const message = await repositories.messages.create({
      conversationId: headMessage.conversationId,
      senderId,
      content: `🎙️ **${recordingName}** ready`,
      msgType: bot ? MessageType.BOT : MessageType.SYSTEM,
      showInChannel: false,
      hasAttachment: true,
      metadata: {
        messageSubtype: 'recording',
        callId: call.externalId,
        recordingId: recording.id,
        recordingType: recording.recordingType,
        contentFormat: 'markdown',
      },
    });
    await repositories.callRecordings.setMessageId(recording.id, message.messageId);

    let fileSize = 0;
    try {
      const meta = await this.storageService.getFileMetadata(recording.storagePath!);
      fileSize = parseInt(String(meta.size || '0'), 10);
    } catch (err) {
      logger.warn(`[CallRecording] Could not get file size for ${recording.storagePath}: ${err}`);
    }

    await repositories.messageAttachments.create({
      entityId: message.messageId,
      entityType: AttachmentEntityType.CHAT,
      workspaceId,
      originalFilename: displayFilename,
      size: fileSize,
      mimetype,
      url: recording.storagePath!,
      uploadedByUserId: recording.startedBy ?? call.createdByUserId,
      createdBy: recording.startedBy ?? call.createdByUserId,
      storageProvider: config.fileStorage.provider,
      conversationId: headMessage.conversationId,
      metadata: {
        callId: call.externalId,
        recordingId: recording.id,
        type: 'recording',
      },
    });

    await repositories.conversations.incrementReplyCount(headMessage.conversationId);
    logger.info(`[CallRecording] Posted recording message ${message.messageId} + attachment for recording ${recording.id}`);
  }

  /**
   * Update the display filename of a call's recording attachments to include the
   * (newly generated) call title. Called when a call title is generated late.
   * Operates per-recording — each recording owns its own thread message + attachment.
   */
  async updateRecordingFilename(callExternalId: string, callTitle: string): Promise<void> {
    try {
      const call = await repositories.calls.findByExternalId(callExternalId);
      if (!call) return;
      const recordings = await repositories.callRecordings.listByCallId(call.id);
      for (const recording of recordings) {
        if (!recording.messageId) continue;
        const attachments = await repositories.messageAttachments.findByEntityIdAndType(
          recording.messageId,
          AttachmentEntityType.CHAT,
        );
        const label = recording.name?.trim() || 'Recording';
        for (const attachment of attachments) {
          await repositories.messageAttachments.update(attachment.id, {
            originalFilename: `${callTitle} - ${label}.mp4`,
          });
        }
      }
      logger.info(`[CallRecording] Updated recording filenames for call ${callExternalId} → "${callTitle}"`);
    } catch (err) {
      logger.warn(`[CallRecording] Failed to update recording filename for call ${callExternalId}:`, err);
    }
  }

  /**
   * Manual user delete (starter-only authz is enforced in the controller). Soft
   * delete: status → DELETED (row kept for audit), file + attachment + thread
   * message removed so the chat doesn't show a dead player.
   */
  async deleteRecording(recording: CallRecording): Promise<void> {
    if (recording.storagePath) {
      try {
        await this.storageService.deleteFile(recording.storagePath);
      } catch (err) {
        logger.warn(`[CallRecording] Could not delete file ${recording.storagePath} for recording ${recording.id}: ${err}`);
      }
    }
    // Drop any HLS segments left behind (recording deleted mid-processing).
    if (recording.segmentPrefix) {
      await this.deleteSegments(recording.segmentPrefix);
    }
    if (recording.messageId) {
      try {
        await repositories.messageAttachments.deleteByMessageId(recording.messageId);
        await repositories.messages.update(recording.messageId, {
          content: 'Recording deleted',
          hasAttachment: false,
        });
      } catch (err) {
        logger.warn(`[CallRecording] Could not clean message ${recording.messageId} for recording ${recording.id}: ${err}`);
      }
    }
    await repositories.callRecordings.markDeleted(recording.id);
    logger.info(`[CallRecording] Soft-deleted recording ${recording.id}`);
  }

  /** Create a readable stream for a recording file from storage, by recording id. */
  async streamRecordingById(recordingId: string): Promise<{ stream: NodeJS.ReadableStream; filename: string } | null> {
    const path = await this.getStoragePathById(recordingId);
    if (!path) return null;
    const stream = await this.storageService.createReadStream(path);
    const filename = path.split('/').pop() ?? `recording-${recordingId}.mp4`;
    return { stream, filename };
  }

  async getRecordingMetadataById(recordingId: string): Promise<Record<string, unknown> | null> {
    const path = await this.getStoragePathById(recordingId);
    if (!path) return null;
    try {
      return await this.storageService.getFileMetadata(path) as Record<string, unknown>;
    } catch (err) {
      logger.warn(`[CallRecording] getRecordingMetadataById failed for ${recordingId}: ${err}`);
      return null;
    }
  }

  /** Resolve a recording's storage path, verifying the file still exists. */
  async getStoragePathById(recordingId: string): Promise<string | null> {
    const recording = await repositories.callRecordings.findById(recordingId);
    if (!recording?.storagePath) {
      logger.warn(`[CallRecording] getStoragePathById: no storagePath for recording ${recordingId}`);
      return null;
    }
    try {
      const exists = await this.storageService.fileExists(recording.storagePath);
      if (!exists) {
        logger.warn(`[CallRecording] getStoragePathById: file not found at ${recording.storagePath}`);
        return null;
      }
    } catch (err) {
      logger.error(`[CallRecording] getStoragePathById: fileExists threw for ${recording.storagePath}:`, err);
      return null;
    }
    return recording.storagePath;
  }

  /**
   * Cleanup expired recordings (cron). Two passes for different retention windows.
   * Deletes the file, marks the row EXPIRED, and removes the recording's thread
   * message attachment so the chat doesn't show a dead player (H2).
   */
  async cleanupExpiredRecordings(): Promise<void> {
    let totalCleaned = 0;

    const passes: Array<{ days: number; types: RecordingType[] }> = [
      { days: this.getRetentionDays(), types: [RecordingType.AUDIO_ONLY] },
      { days: config.screenRecording.retentionDays, types: [RecordingType.AUDIO_SCREEN, RecordingType.AUDIO_VIDEO] },
    ];

    for (const pass of passes) {
      if (pass.days <= 0) continue;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - pass.days);
      for (const type of pass.types) {
        const expired = await repositories.callRecordings.findExpiredUploaded(cutoff, type);
        for (const recording of expired) {
          try {
            if (recording.storagePath) {
              await this.storageService.deleteFile(recording.storagePath);
            }
            await repositories.callRecordings.markExpired(recording.id);
            if (recording.messageId) {
              await repositories.messageAttachments.deleteByMessageId(recording.messageId);
              await repositories.messages.update(recording.messageId, {
                content: 'Recording expired',
                hasAttachment: false,
              });
            }
            logger.info(`[CallRecording] Expired recording ${recording.id} (${type}), path=${recording.storagePath}`);
            totalCleaned++;
          } catch (err) {
            logger.error(`[CallRecording] Failed to expire recording ${recording.id}:`, err);
          }
        }
      }
    }

    if (totalCleaned > 0) {
      logger.info(`[CallRecording] Cleaned up ${totalCleaned} expired recordings`);
    }
  }
}

export const callRecordingService = new CallRecordingService();
