import { EgressClient, EgressStatus, EncodedFileOutput, EncodedFileType, GCPUpload, S3Upload, EgressInfo } from 'livekit-server-sdk';
import { AttachmentEntityType } from '@prisma/client';
import { config } from '@/config/env';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';

class CallRecordingService {
  private egressClient: EgressClient;
  /** In-memory map of roomName → active egressId. Sufficient for a single-process dev server. */
  private activeEgress = new Map<string, string>();

  private get storageService() {
    const bucket = config.gcs.transcriptionBucketName;
    return getStorageService(bucket);
  }

  constructor() {
    this.egressClient = new EgressClient(
      config.livekit.url,
      config.livekit.apiKey,
      config.livekit.apiSecret,
    );
  }

  /** Get retention days from config */
  getRetentionDays(): number {
    return config.callRecording.retentionDays;
  }

  /** Check if recording is enabled */
  isRecordingEnabled(): boolean {
    return config.callRecording.enabled;
  }

  /** Build the GCS filepath for a recording */
  private buildRecordingPath(callExternalId: string, createdAt: Date): string {
    const dateStr = createdAt.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
    return `recordings/${callExternalId}_${dateStr}.mp4`;
  }

  /** Start composite audio recording for a room */
  async startRecording(callExternalId: string, callCreatedAt: Date): Promise<string | null> {
    try {
      const filepath = this.buildRecordingPath(callExternalId, callCreatedAt);

      const uploadOutput =
        config.fileStorage.provider === 's3'
          ? {
              case: 's3' as const,
              value: new S3Upload({
                bucket: config.gcs.transcriptionBucketName,
                region: config.s3.region,
                accessKey: config.s3.accessKeyId,
                secret: config.s3.secretAccessKey,
                ...(config.s3.endpoint ? { endpoint: config.s3.endpoint, forcePathStyle: true } : {}),
              }),
            }
          : {
              case: 'gcp' as const,
              value: new GCPUpload({
                bucket: config.gcs.transcriptionBucketName,
              }),
            };

      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath,
        output: uploadOutput,
      });

      const info: EgressInfo = await this.egressClient.startRoomCompositeEgress(
        callExternalId,
        output,
        { audioOnly: true },
      );

      this.activeEgress.set(callExternalId, info.egressId);
      logger.info(`[CallRecording] Started egress for call ${callExternalId}, egressId=${info.egressId}, path=${filepath}`);
      return info.egressId;
    } catch (error) {
      logger.error(`[CallRecording] Failed to start egress for call ${callExternalId}:`, error);
      return null;
    }
  }

  /**
   * Gracefully stop an active egress when the last participant leaves.
   * This tells the egress worker to flush its buffer and upload to GCS before the room closes.
   * The egress_ended webhook will fire with EGRESS_COMPLETE once done.
   */
  async stopRecording(callExternalId: string): Promise<void> {
    const egressId = this.activeEgress.get(callExternalId);
    if (!egressId) {
      logger.debug(`[CallRecording] stopRecording: no active egress tracked for call ${callExternalId}`);
      return;
    }
    this.activeEgress.delete(callExternalId);
    try {
      // Check current status before attempting to stop — only STARTING and ACTIVE can be stopped
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
      logger.info(`[CallRecording] Gracefully stopped egress ${egressId} for call ${callExternalId}`);
    } catch (err) {
      logger.error(`[CallRecording] Failed to stop egress ${egressId} for call ${callExternalId}:`, err);
    }
  }

  /** Handle egress_ended webhook — save recordingUrl and create MessageAttachment */
  async handleEgressCompleted(callExternalId: string): Promise<void> {
    // Clean up tracking entry in case stopRecording wasn't called (e.g. EGRESS_COMPLETE from natural end)
    this.activeEgress.delete(callExternalId);
    const call = await repositories.calls.findByExternalId(callExternalId);
    if (!call) {
      logger.warn(`[CallRecording] No call found for externalId=${callExternalId}`);
      return;
    }

    const recordingPath = this.buildRecordingPath(call.externalId, call.createdAt);
    await repositories.calls.setRecordingUrl(call.id, recordingPath);
    logger.info(`[CallRecording] Saved recordingUrl for call ${call.externalId}, path=${recordingPath}`);

    // Create (or skip if already exists) a MessageAttachment so the recording
    // appears inline in the call message bubble.
    try {
      const existing = await repositories.messageAttachments.findRecordingByCallId(callExternalId);
      if (existing) {
        logger.info(`[CallRecording] Recording attachment already exists for call ${callExternalId}, skipping creation`);
        return;
      }

      const callMessage = await repositories.messages.findHeadMessageByCallId(callExternalId);
      if (!callMessage) {
        logger.warn(`[CallRecording] Could not find head message for call ${callExternalId}, skipping attachment creation`);
        return;
      }

      const filename = recordingPath.split('/').pop() ?? `recording-${callExternalId}.mp4`;

      // Fetch real file size from storage so the attachment doesn't show "0 B" in the UI.
      let fileSize = 0;
      try {
        const meta = await this.storageService.getFileMetadata(recordingPath);
        fileSize = parseInt(String(meta.size || '0'), 10);
      } catch (err) {
        logger.warn(`[CallRecording] Could not get file size for ${recordingPath}: ${err}`);
      }

      await repositories.messageAttachments.create({
        entityId: callMessage.messageId,
        entityType: AttachmentEntityType.CHAT,
        originalFilename: filename,
        size: fileSize,
        mimetype: 'audio/mp4',
        url: recordingPath,
        uploadedByUserId: call.createdByUserId,
        createdBy: call.createdByUserId,
        storageProvider: config.fileStorage.provider,
        conversationId: callMessage.conversationId,
        metadata: {
          callId: callExternalId,
          type: 'recording',
        },
      });

      await repositories.messages.update(callMessage.messageId, { hasAttachment: true });
      logger.info(`[CallRecording] Created recording attachment for call ${callExternalId}, message ${callMessage.messageId}`);
    } catch (err) {
      logger.error(`[CallRecording] Failed to create recording attachment for call ${callExternalId}:`, err);
    }
  }

  /** Create a readable stream for the recording file from storage */
  async streamRecording(callExternalId: string): Promise<{ stream: NodeJS.ReadableStream; filename: string } | null> {
    const path = await this.getRecordingPath(callExternalId);
    if (!path) return null;
    const stream = await this.storageService.createReadStream(path);
    const filename = path.split('/').pop() ?? `recording-${callExternalId}.mp4`;
    return { stream, filename };
  }

  /** Return storage metadata for the recording file, or null if not available */
  async getRecordingMetadata(callExternalId: string): Promise<Record<string, unknown> | null> {
    const path = await this.getRecordingPath(callExternalId);
    if (!path) return null;
    try {
      return await this.storageService.getFileMetadata(path) as Record<string, unknown>;
    } catch (err) {
      logger.warn(`[CallRecording] getRecordingMetadata failed for ${callExternalId}: ${err}`);
      return null;
    }
  }

  /** Get the storage path for a call recording, or null if not available/found */
  async getRecordingPath(callExternalId: string): Promise<string | null> {
    const call = await repositories.calls.findByExternalIdWithRecordingUrl(callExternalId);
    if (!call?.recordingUrl) {
      logger.warn(`[CallRecording] getRecordingPath: no recordingUrl stored in DB for call ${callExternalId}`);
      return null;
    }

    let exists: boolean;
    try {
      exists = await this.storageService.fileExists(call.recordingUrl);
    } catch (err) {
      logger.error(`[CallRecording] getRecordingPath: fileExists check threw for path=${call.recordingUrl}:`, err);
      return null;
    }

    if (!exists) {
      logger.warn(`[CallRecording] getRecordingPath: file not found at path=${call.recordingUrl}`);
      return null;
    }

    return call.recordingUrl;
  }

  /** Cleanup expired recordings (called by cron) */
  async cleanupExpiredRecordings(): Promise<void> {
    const retentionDays = this.getRetentionDays();
    if (retentionDays <= 0) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const expiredCalls = await repositories.calls.findExpiredRecordings(cutoffDate);

    for (const call of expiredCalls) {
      try {
        await this.storageService.deleteFile(call.recordingUrl);
        await repositories.calls.setRecordingUrl(call.id, null);
        logger.info(`[CallRecording] Deleted expired recording: ${call.recordingUrl}`);
      } catch (err) {
        logger.error(`[CallRecording] Failed to delete recording ${call.recordingUrl}:`, err);
      }
    }

    if (expiredCalls.length > 0) {
      logger.info(`[CallRecording] Cleaned up ${expiredCalls.length} expired recordings`);
    }
  }
}

export const callRecordingService = new CallRecordingService();
