import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { Call } from '@prisma/client';
import { CallStatus, CallOrigin } from '@xyne/shared';
import { livekitService } from '@/services/liveKitService';
import { repositories } from '@/database/repositories';
import { updateCallSystemMessageIfNeeded } from '@/zero/utils/systemMessagesUtils';
import { recurringCallService } from '@/services/recurringCallService';
import { callSideEffectService } from '@/services/callSideEffectService';
import { noteTakerTranscriptService } from '@/services/noteTakerTranscriptService';
import { logDetailedSummaryFailed } from '@/services/detailedSummaryFailureLog';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// A recording whose detailed summary has been 'pending' this long with no row
// activity is treated as stranded (the API process that owned the in-flight
// generation is gone). Must stay above the worst-case honest run — roughly
// 55 min with callLlmRetry's 5 attempts × 5 min timeout plus 2/4/8/16 min
// backoff — so a slow-but-alive run is not swept prematurely. If one is, it
// simply overwrites 'failed' with 'ready' when it finishes.
const SUMMARY_PENDING_STALE_MS = 60 * 60 * 1000; // 1 hour
const SUMMARY_SWEEP_BATCH_SIZE = 50;

/**
 * Call Validation Worker
 *
 * Runs periodically to validate active calls against LiveKit room state.
 * Automatically ends calls that:
 * - Have no corresponding LiveKit room
 * - Have zero active participants in LiveKit
 *
 * Also sweeps HEADLESS recordings whose detailed summary has been stuck in
 * 'pending' for over an hour, marking them 'failed' so the recording screen
 * offers "Try again" instead of shimmering forever.
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

      // Run all checks in parallel
      await Promise.all([
        this.validateLiveActiveCalls(),
        this.cleanupStaleScheduledCalls(),
        this.failStalePendingSummaries(),
      ]);

      logger.info('[CallValidationWorker] Validation cycle completed');
    } catch (error) {
      logger.error('[CallValidationWorker] Error during validation cycle:', error);
    } finally {
      this.isRunning = false;
    }
  }

  private async validateLiveActiveCalls(): Promise<void> {
    try {
      const activeCalls = await repositories.calls.findAllActiveCalls(10);

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
    } catch (error) {
      logger.error('[CallValidationWorker] Error validating live active calls:', error);
    }
  }

  /**
   * Defense mechanism: find SCHEDULED calls whose endsAt has passed and
   * verify there is no active LiveKit room for them. If there is no room,
   * mark the call as ENDED. This catches cases where the Bull auto-end job
   * was lost (e.g. Redis restart, cancelled instance chain broken, etc.).
   */
  private async cleanupStaleScheduledCalls(): Promise<void> {
    try {
      const staleCalls = await repositories.calls.findStaleScheduledCalls(10, [
        CallOrigin.GOOGLE_CALENDAR,
        CallOrigin.MICROSOFT_CALENDAR,
      ]);

      if (staleCalls.length === 0) {
        logger.debug('[CallValidationWorker] No stale scheduled calls found');
        return;
      }

      logger.info(`[CallValidationWorker] Found ${staleCalls.length} stale scheduled call(s) to inspect`);

      // Batch-fetch room info for all stale calls
      const roomNames = staleCalls.map(call => call.externalId);
      const roomInfos = await livekitService.listRooms(roomNames);
      const roomInfoMap = new Map(roomInfos.map(room => [room.name, room]));

      for (const call of staleCalls) {
        await this.endStaleScheduledCall(call, roomInfoMap);
      }
    } catch (error) {
      logger.error('[CallValidationWorker] Error cleaning up stale scheduled calls:', error);
    }
  }

  private async endStaleScheduledCall(call: Call, roomInfoMap: Map<string, any>): Promise<void> {
    const { id: callId, externalId, recurringSeriesId } = call;

    try {
      const roomInfo = roomInfoMap.get(externalId);

      if (roomInfo && roomInfo.numParticipants > 0) {
        // A live room exists with active participants — the call is actually ongoing.
        // The webhook will handle transitioning it to ENDED when the room finishes.
        logger.info(
          `[CallValidationWorker] Stale scheduled call ${externalId} has an active LiveKit room (${roomInfo.numParticipants} participant(s)) — skipping`,
        );
        return;
      }

      // No room or empty room — safe to end
      await repositories.calls.update(callId, { status: CallStatus.ENDED });
      logger.info(
        `[CallValidationWorker] Ended stale scheduled call ${externalId} — endsAt passed with no active LiveKit room`,
      );

      // Trigger recurring series chain so the next instance gets its Bull jobs
      if (recurringSeriesId) {
        try {
          await Promise.all([
            recurringCallService.replenishInstanceBuffer(recurringSeriesId),
            recurringCallService.scheduleJobsForNextInstance(recurringSeriesId, call.endsAt ?? new Date()),
          ]);
          logger.info(
            `[CallValidationWorker] Replenished buffer and scheduled next Bull jobs for series ${recurringSeriesId}`,
          );
        } catch (err) {
          logger.error(
            `[CallValidationWorker] Failed to replenish/schedule next jobs for series ${recurringSeriesId}:`,
            err,
          );
        }
      }
    } catch (error) {
      logger.error(`[CallValidationWorker] Failed to clean up stale scheduled call ${externalId}:`, error);
    }
  }

  /**
   * Defense mechanism for stranded summary generation: summary work runs
   * in-process in the API (awaited in the transcript-ready webhook, or
   * fire-and-forget from the regenerate endpoint), so a backend restart
   * mid-run leaves Call.metadata.detailedSummaryStatus at 'pending' with
   * nothing to ever flip it. Marking such rows 'failed' lets the recording
   * screen (which trusts the backend status) surface "Try again" — the
   * status change reaches open screens through Zero sync.
   */
  private async failStalePendingSummaries(): Promise<void> {
    try {
      const staleBefore = new Date(Date.now() - SUMMARY_PENDING_STALE_MS);
      const staleCalls = await repositories.calls.findStalePendingSummaryCalls(
        SUMMARY_SWEEP_BATCH_SIZE,
        staleBefore,
      );

      if (staleCalls.length === 0) {
        logger.debug('[CallValidationWorker] No stale pending summaries found');
        return;
      }

      logger.info(
        `[CallValidationWorker] Found ${staleCalls.length} recording(s) with a summary stuck in 'pending'`,
      );

      for (const call of staleCalls) {
        await this.failStalePendingSummary(call);
      }
    } catch (error) {
      logger.error('[CallValidationWorker] Error sweeping stale pending summaries:', error);
    }
  }

  private async failStalePendingSummary(call: Call): Promise<void> {
    const { externalId, endedAt, updatedAt } = call;

    try {
      await noteTakerTranscriptService.markDetailedSummaryStatus(call, 'failed');
      logDetailedSummaryFailed(externalId, 'stale_pending_swept');
      logger.info(
        `[CallValidationWorker] [${externalId}] detailed_summary_status_updated | from=pending, to=failed, reason=stale_pending_swept`,
        { endedAt, updatedAt },
      );
    } catch (error) {
      logger.error(`[CallValidationWorker] Failed to sweep stale pending summary ${externalId}:`, error);
    }
  }

  private async validateCall(call: Call, roomInfoMap: Map<string, any>): Promise<void> {
    const { id: callId, externalId, status } = call;
    
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

        // Emit analytics events (call_ended + per-participant) for the Calls dashboards
        try {
          await callSideEffectService.logCallAnalytics(call as Parameters<typeof callSideEffectService.logCallAnalytics>[0], endedAt);
        } catch (analyticsError) {
          logger.error(`[CallValidationWorker] Failed to log call analytics for ${externalId}:`, analyticsError);
        }
      }
    } catch (error) {
      logger.error(`[CallValidationWorker] Failed to validate call ${externalId}:`, error);
      // Continue with other calls even if one fails
    }
  }
}

export const callValidationWorker = CallValidationWorker.getInstance();
