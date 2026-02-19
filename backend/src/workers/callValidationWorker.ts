import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { Call } from '@prisma/client';
import { livekitService } from '@/services/liveKitService';
import { repositories } from '@/database/repositories';
import { updateCallSystemMessageIfNeeded } from '@/zero/utils/systemMessagesUtils';
import { callCountService } from '@/services/callCountService';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Call Validation Worker
 * 
 * Runs periodically to validate active calls against LiveKit room state.
 * Automatically ends calls that:
 * - Have no corresponding LiveKit room
 * - Have zero active participants in LiveKit
 * 
 * This replaces the frontend-triggered validateRooms endpoint to avoid
 * unnecessary API calls triggered by participant updates.
 */
export class CallValidationWorker {
  private static instance: CallValidationWorker;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  private constructor() {}

  public static getInstance(): CallValidationWorker {
    if (!CallValidationWorker.instance) {
      CallValidationWorker.instance = new CallValidationWorker();
    }
    return CallValidationWorker.instance;
  }

  public async start(): Promise<void> {
    if (this.intervalId) {
      logger.warn('[CallValidationWorker] Worker already running');
      return;
    }

    logger.info(`[CallValidationWorker] Starting worker (interval: ${POLL_INTERVAL_MS}ms)`);

    // Run immediately on start
    await this.validateActiveCalls();

    // Schedule periodic validation
    this.intervalId = setInterval(() => {
      void this.validateActiveCalls();
    }, POLL_INTERVAL_MS);

    logger.info('[CallValidationWorker] Worker started successfully');
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[CallValidationWorker] Worker stopped');
    }
  }

  private async validateActiveCalls(): Promise<void> {
    // Prevent concurrent executions
    if (this.isRunning) {
      logger.debug('[CallValidationWorker] Validation already in progress, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('[CallValidationWorker] Starting validation cycle');

      // Fetch all active calls
      const activeCalls = await repositories.calls.findAllActiveCalls();

      if (activeCalls.length === 0) {
        logger.debug('[CallValidationWorker] No active calls to validate');
        return;
      }

      logger.info(`[CallValidationWorker] Validating ${activeCalls.length} active calls`);

      // Fetch all room info in a single API call (much more efficient than one call per room)
      const roomNames = activeCalls.map(call => call.externalId);
      const roomInfos = await livekitService.listRooms(roomNames);
      
      // Create a map for quick lookup: roomName -> roomInfo
      const roomInfoMap = new Map(roomInfos.map(room => [room.name, room]));

      logger.debug(`[CallValidationWorker] Fetched info for ${roomInfos.length}/${roomNames.length} rooms from LiveKit`);

      // Validate each call sequentially using the fetched room data
      for (const call of activeCalls) {
        await this.validateCall(call, roomInfoMap);
      }

      logger.info('[CallValidationWorker] Validation cycle completed');
    } catch (error) {
      logger.error('[CallValidationWorker] Error during validation cycle:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async validateCall(call: Call, roomInfoMap: Map<string, any>): Promise<void> {
    const { id: callId, externalId, status, startedAt } = call;
    
    try {
      // Get room info from the pre-fetched map (no API call needed)
      const roomInfo = roomInfoMap.get(externalId);

      let shouldEndCall = false;
      let reason = '';

      // Check if room doesn't exist
      if (!roomInfo) {
        shouldEndCall = true;
        reason = 'room not found';
      } else {
        // Use numParticipants from room info (no need for separate listParticipants call)
        logger.debug(
          `[CallValidationWorker] Room ${externalId} - numParticipants: ${roomInfo.numParticipants}`,
        );

        // Check if room has no active participants
        if (roomInfo.numParticipants === 0) {
          shouldEndCall = true;
          reason = 'no active participants';
        }
      }

      // Mark call as ended if either condition is true
      if (shouldEndCall) {
        const endedAt = new Date();

        // Use transaction to atomically update call and system message
        await db.$transaction(async (tx) => {
          // End the call
          await repositories.calls.endCall(callId, endedAt, tx);

          logger.info(
            `[CallValidationWorker] [${externalId}] call_status_updated | from=${status}, to=ENDED, reason=${reason}`,
          );

          // Update system message if needed
          const messageUpdated = await updateCallSystemMessageIfNeeded({
            call,
            callId: externalId,
            endedAt,
            tx,
          });

          if (messageUpdated) {
            logger.info(`[CallValidationWorker] Updated system message for call ${externalId}`);
          }
        });

        logger.info('[CallValidationWorker] Transcript will be processed when user views the ended call message');

        // Increment call count and add duration only for calls lasting > 60 seconds
        const callDurationSeconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
        if (callDurationSeconds > 60) {
          // Convert duration to minutes (rounded to 1 decimal place)
          const callDurationMinutes = Math.round((callDurationSeconds / 60) * 10) / 10;

          try {
            await Promise.all([
              callCountService.incrementCount(),
              callCountService.addCallDuration(callDurationMinutes),
            ]);
            logger.info(
              `[CallValidationWorker] Successfully updated metrics for call ${externalId} (duration: ${callDurationSeconds}s / ${callDurationMinutes}m)`,
            );
          } catch (err) {
            logger.error('[CallValidationWorker] Failed to update call metrics for auto-ended call:', err);
          }
        }
      }
    } catch (error) {
      logger.error(`[CallValidationWorker] Failed to validate call ${externalId}:`, error);
      // Continue with other calls even if one fails
    }
  }
}

export const callValidationWorker = CallValidationWorker.getInstance();
