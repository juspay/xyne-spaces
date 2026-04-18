import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import { getStorageService } from '@/services/storage';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import {  SessionRecordingProcessStatus  } from '@prisma/client';
import { conversationIngestQueue } from '@/queues/conversationIngestQueue';;
import { SESSION_RECORDING_KEYS_SET, parseSessionRecordingKey } from '@/utils/sessionRecordingKeys';

interface SessionBatch {
  sessionId: string;
  userId: string;
  repoUrl: string;
  ticketId?: string;
  commitId?: string;
  agentUsed: string[];
  modelUsed: string[];
  timestamp: string;
  messages: any[];
}

interface SessionRecording {
  sessionId: string;
  userId: string;
  repoUrl: string;
  ticketId?: string;
  commitId?: string;
  agentUsed: string[];
  modelUsed: string[];
  messages: any[];
}

class SessionRecordingSyncService {
  private storageService = getStorageService(config.gcs.sessionRecordingBucketName);

  /**
   * Sync all session recordings from Redis to GCS.
   * Called by the cron job every 5 minutes.
   */
  async syncAllSessionRecordings(): Promise<void> {
    try {
      // Get all session recording keys from the global tracking set
      const keys = await redisService.smembers(SESSION_RECORDING_KEYS_SET);

      logger.info(`[SESSION-RECORDING-SYNC] Found ${keys.length} session recording keys in Redis set: ${SESSION_RECORDING_KEYS_SET}`);

      if (keys.length === 0) {
        logger.info(`[SESSION-RECORDING-SYNC] No session recording keys found in tracking set`);
        return;
      }

      // Process each key
      for (const key of keys) {
        try {
          await this.syncSessionRecording(key);
        } catch (error) {
          logger.error(`[SESSION-RECORDING-SYNC] Failed to sync ${key}:`, error);
          // Continue with other keys
        }
      }

      logger.info(`[SESSION-RECORDING-SYNC] Completed sync for ${keys.length} session keys`);
    } catch (error) {
      logger.error('[SESSION-RECORDING-SYNC] Failed to sync session recordings:', error);
      throw error;
    }
  }

  /**
   * Sync a single session recording from Redis to GCS.
   * Reads from Redis and directly uploads to GCS (overwrites existing file).
   */
  private async syncSessionRecording(redisKey: string): Promise<void> {
    const sessionId = parseSessionRecordingKey(redisKey);

    if (!sessionId) {
      logger.warn(`[SESSION-RECORDING-SYNC] Invalid Redis key format: ${redisKey}`);
      return;
    }

    // Read all batches from Redis atomically using Lua script
    // Deletes the key and removes from tracking set after reading
    const redisData = await redisService.fetchListAndDelete(redisKey, SESSION_RECORDING_KEYS_SET);

    if (!redisData || redisData.length === 0) {
      logger.info(`[SESSION-RECORDING-SYNC] No data in Redis for ${redisKey}, key cleaned up`);
      return;
    }

    // Parse Redis data
    const batches: SessionBatch[] = redisData.map(item => JSON.parse(item));

    // Use first batch for metadata (all batches have same session info)
    const firstBatch = batches[0];
    
    if (!firstBatch.userId) {
      logger.warn(`[SESSION-RECORDING-SYNC] No userId found for session: ${sessionId}`);
      return;
    }

    // Construct GCS path from sessionId and userId
    const gcsPath = `sessions/${firstBatch.userId}/${sessionId}/recording.json`;

    // Aggregate all messages from all batches
    const messages: any[] = [];
    for (const batch of batches) {
      if (batch.messages && Array.isArray(batch.messages)) {
        messages.push(...batch.messages);
      }
    }

    // Sort messages by timestamp (if available)
    messages.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeA - timeB;
    });

    // Build recording object in new format
    const recording: SessionRecording = {
      sessionId: firstBatch.sessionId,
      userId: firstBatch.userId,
      repoUrl: firstBatch.repoUrl || '',
      agentUsed: firstBatch.agentUsed || [],
      modelUsed: firstBatch.modelUsed || [],
      messages,
      ...(firstBatch.ticketId ? { ticketId: firstBatch.ticketId } : {}),
      ...(firstBatch.commitId ? { commitId: firstBatch.commitId } : {}),
    };

    // Read existing recording from GCS if exists
    const existingRecording = await this.readExistingRecording(gcsPath);

    // Merge recordings (Redis data wins on conflict)
    const mergedRecording = this.mergeRecordings(existingRecording, recording);

    // Upload to GCS
    await this.uploadToGcs(gcsPath, mergedRecording);

    const gcsUri = this.storageService.buildStorageUri(gcsPath);

    // Track in database for SOP/fact extraction workflow
    await this.trackSessionRecordingFile(
      sessionId,
      firstBatch.userId,
      gcsUri,
      mergedRecording.messages.length
    );

      conversationIngestQueue.addJob({
        gcsUri,
        source: 'xyne-cli',
        sourceId: `${sessionId}`,
      }).catch((queueErr) => {
        logger.error(`[SESSION-RECORDING-SYNC] Failed to enqueue ingest job for session ${sessionId}:`, queueErr);
      });

    logger.info(`[SESSION-RECORDING-SYNC] Synced ${batches.length} batches for ${redisKey} to GCS: ${gcsPath}`, {
      messageCount: messages.length,
      mergedMessageCount: mergedRecording.messages.length,
    });
  }

  /**
   * Track session recording file in database for SOP/fact extraction
   * Creates or updates the record with PENDING status
   */
  private async trackSessionRecordingFile(
    sessionId: string,
    userId: string,
    url: string,
    totalMessages: number
  ): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();

      await (prisma as any).sessionRecordingFile.upsert({
        where: { sessionId },
        update: {
          status: SessionRecordingProcessStatus.PENDING,
          url,
        },
        create: {
          sessionId,
          userId,
          url,
          status: SessionRecordingProcessStatus.PENDING,
          lastProcessedTurn: null,
        },
      });

      logger.info(`[SESSION-RECORDING-SYNC] Tracked session recording file: ${sessionId}`, {
        totalMessages,
      });
    } catch (error) {
      logger.error(`[SESSION-RECORDING-SYNC] Failed to track session recording file: ${sessionId}`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - tracking failure shouldn't fail the sync
    }
  }

  /**
   * Read existing recording from GCS
   */
  private async readExistingRecording(gcsPath: string): Promise<SessionRecording | null> {
    try {
      const buffer = await this.storageService.getFileBuffer(gcsPath);
      
      if (!buffer) {
        return null;
      }

      return JSON.parse(buffer.toString()) as SessionRecording;
    } catch (error) {
      // File doesn't exist or other error - return null
      return null;
    }
  }

  /**
   * Merge existing GCS recording with Redis recording
   * Redis data wins on message ID conflict (more recent)
   */
  private mergeRecordings(
    existing: SessionRecording | null,
    fromRedis: SessionRecording
  ): SessionRecording {
    if (!existing) {
      return fromRedis;
    }

    // Create a map of existing messages by ID
    const messageMap = new Map<string, any>();
    
    for (const message of existing.messages) {
      if (message.id) {
        messageMap.set(message.id, message);
      }
    }

    // Override with Redis messages (Redis wins on conflict)
    for (const message of fromRedis.messages) {
      if (message.id) {
        messageMap.set(message.id, message);
      }
    }

    // Convert back to sorted array (by timestamp)
    const mergedMessages = Array.from(messageMap.values()).sort(
      (a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return timeA - timeB;
      }
    );

    return {
      ...fromRedis,
      messages: mergedMessages,
    };
  }

  /**
   * Upload recording to GCS
   */
  private async uploadToGcs(gcsPath: string, recording: SessionRecording): Promise<void> {
    const buffer = Buffer.from(JSON.stringify(recording, null, 2));

    await this.storageService.uploadFileV2(buffer, {
      path: gcsPath,
      contentType: 'application/json',
    });
  }
}

export const sessionRecordingSyncService = new SessionRecordingSyncService();