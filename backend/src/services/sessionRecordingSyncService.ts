import { logger } from '@/utils/logger';
import { redisService } from '@/services/redisService';
import GCSServiceFactory from '@/services/gcsServiceFactory';
import { config } from '@/config/env';
import { DatabaseClient } from '@/database/client';
import { SessionRecordingProcessStatus } from '@prisma/client';

interface SessionBatch {
  sessionId: string;
  userId: string;
  repoUrl: string;
  ticketId: string;
  commitId: string;
  agentUsed: string[];
  modelUsed: string[];
  timestamp: string;
  messages: any[];
}

interface SessionRecording {
  sessionId: string;
  userId: string;
  repoUrl: string;
  ticketId: string;
  commitId: string;
  agentUsed: string[];
  modelUsed: string[];
  messages: any[];
}

// Redis key pattern for session recordings
const SESSION_RECORDING_KEY_PATTERN = 'session-recording:*';

class SessionRecordingSyncService {
  private gcsService = GCSServiceFactory.getService(config.gcs.sessionRecordingBucketName);

  /**
   * Sync all session recordings from Redis to GCS.
   * Called by the cron job every 5 minutes.
   */
  async syncAllSessionRecordings(): Promise<void> {
    try {
      const redis = redisService.getClient();
      const keys: string[] = [];

      logger.info(`[SESSION-RECORDING-SYNC] Starting SCAN with pattern: ${SESSION_RECORDING_KEY_PATTERN}`);

      // Use SCAN to find all keys matching pattern
      let cursor = '0';
      let scanIterations = 0;
      do {
        scanIterations++;
        const result = await redis.scan(cursor, 'MATCH', SESSION_RECORDING_KEY_PATTERN, 'COUNT', 100);
        cursor = result[0];
        keys.push(...result[1]);
        logger.info(`[SESSION-RECORDING-SYNC] SCAN iteration ${scanIterations}: cursor=${cursor}, found ${result[1].length} keys`);
      } while (cursor !== '0');

      logger.info(`[SESSION-RECORDING-SYNC] Found ${keys.length} session recording keys via SCAN`);

      if (keys.length === 0) {
        logger.info(`[SESSION-RECORDING-SYNC] No session recording keys found`);
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
    const sessionId = redisKey.replace('session-recording:', '');

    // Read all batches from Redis atomically using Lua script
    // Deletes the key after reading
    const redisData = await redisService.fetchListAndCleanupIfEmpty(redisKey);

    if (!redisData || redisData.length === 0) {
      logger.info(`[SESSION-RECORDING-SYNC] No data in Redis for ${redisKey}, key deleted`);
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
      ticketId: firstBatch.ticketId || '',
      commitId: firstBatch.commitId || '',
      agentUsed: firstBatch.agentUsed || [],
      modelUsed: firstBatch.modelUsed || [],
      messages,
    };

    // Read existing recording from GCS if exists
    const existingRecording = await this.readExistingRecording(gcsPath);

    // Merge recordings (Redis data wins on conflict)
    const mergedRecording = this.mergeRecordings(existingRecording, recording);

    // Upload to GCS
    await this.uploadToGcs(gcsPath, mergedRecording);

    // Track in database for SOP/fact extraction workflow
    await this.trackSessionRecordingFile(
      sessionId,
      firstBatch.userId,
      mergedRecording.messages.length
    );

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
    totalMessages: number
  ): Promise<void> {
    try {
      const prisma = DatabaseClient.getInstance();

      await (prisma as any).sessionRecordingFile.upsert({
        where: { sessionId },
        update: {
          status: SessionRecordingProcessStatus.PENDING,
        },
        create: {
          sessionId,
          userId,
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
      const buffer = await this.gcsService.getFileBuffer(gcsPath);
      
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

    await this.gcsService.uploadFileV2(buffer, {
      path: gcsPath,
      contentType: 'application/json',
    });
  }
}

export const sessionRecordingSyncService = new SessionRecordingSyncService();