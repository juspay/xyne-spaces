import { transaction } from '../base';
import { RecurringCallService } from '@/services/recurringCallService';
import { repositories } from '@/database/repositories';
import { RecurringSeriesShape, INSTANCE_BUFFER_DAYS } from '@/services/recurringCallService';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { addHHMMDuration } from '@/utils/dateUtils';
import { logger } from '@/utils/logger';
import { CallStatus, RecurringCallSeriesStatus } from '@xyne/shared';
import { PrismaClient, Prisma } from '@prisma/client';
import { countFutureScheduledInstances, findLastScheduledInstance, findExistingInstanceAt, findNextScheduledInstance, findCallParticipantUserIds } from '@/bypassAcl/transactions/scheduledCallRepository';


export function replenishInstanceBufferTx(db: PrismaClient, seriesId: string, self: RecurringCallService) {
  return transaction(['Call', 'CallParticipant', 'Channel', 'RecurringCallParticipant', 'RecurringCallSeries'], 'replenishInstanceBuffer: series read, future-instance counts and new buffered instances must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const series = await repositories.recurringCallSeries.findById(seriesId, tx);

    if (!series) {
      logger.warn(`Cannot replenish buffer: Series ${seriesId} not found`);
      return;
    }

    if (series.status !== RecurringCallSeriesStatus.ACTIVE) {
      logger.info(`Series ${seriesId} is ${series.status}, skipping buffer replenishment`);
      return;
    }

    // Count current SCHEDULED instances that are in the future (startsAt >= now).
    // Only future instances count toward the buffer — past scheduled instances
    // shouldn't affect replenishment. This must match the targetCount calculation
    // which also counts from now onwards.
    const scheduledCount = await countFutureScheduledInstances({
      seriesId,
      fromDate: new Date(),
      tx,
    });

    // Calculate target count (60 days worth from now)
    const targetCount = self.calculateTargetInstanceCount(series);

    if (scheduledCount >= targetCount) {
      logger.info(`Buffer is full for series ${seriesId}: ${scheduledCount}/${targetCount} instances`);
      return;
    }

    // Find the last scheduled instance to determine where to start creating new ones
    const lastScheduledInstance = await findLastScheduledInstance({
      seriesId,
      tx,
    });

    // Walk forward from the last scheduled instance using getNextOccurrence.
    // getOccurrencesInRange is capped at now+60 days internally, so it cannot
    // find occurrences that lie just beyond the current buffer edge. Using
    // getNextOccurrence (which has no such cap) avoids this problem.
    const neededCount = targetCount - scheduledCount;
    let lastDate = lastScheduledInstance?.startsAt ?? new Date();
    let createdCount = 0;

    while (createdCount < neededCount) {
      const nextOccurrence = self.getNextOccurrence(series, lastDate);
      if (!nextOccurrence) break; // No more occurrences in the series

      // Idempotency: skip only if a SCHEDULED instance already exists at this exact time.
      // CANCELLED instances should NOT block replenishment — a cancelled instance at the
      // same date/slot means we still need to create a replacement.
      const existing = await findExistingInstanceAt({
        seriesId,
        startsAt: nextOccurrence,
        tx,
      });

      if (!existing) {
        const endsAt = addHHMMDuration(nextOccurrence, series.startTime, series.endTime);
        // Don't schedule jobs during replenishment - jobs are created on instance end
        await self.createInstance(series, nextOccurrence, endsAt, false, tx, false, series.callUpdatesChannel);
        createdCount++;
      }

      lastDate = nextOccurrence;
    }

    logger.info(`Replenished buffer for series ${seriesId}: created ${createdCount} instances (${scheduledCount} → ${scheduledCount + createdCount})`);
  });
}
export function regenerateFutureInstancesTx(db: PrismaClient, scheduledInstanceIds: string[], series: RecurringSeriesShape, fromDate: Date, self: RecurringCallService, callIds: string[]) {
  return transaction(['Call', 'CallParticipant', 'Channel', 'RecurringCallParticipant', 'RecurringCallSeries'], 'regenerateFutureInstances: cancelling old instances and creating replacement instances must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    // Mark scheduled instances as CANCELLED (soft-delete)
    if (scheduledInstanceIds.length > 0) {
      await tx.call.updateMany({
        where: {
          id: { in: scheduledInstanceIds },
          status: CallStatus.SCHEDULED,
        },
        data: { status: CallStatus.CANCELLED },
      });

      logger.info(`Marked ${scheduledInstanceIds.length} scheduled instances as CANCELLED for series ${series.id} during regeneration`);
    }

    // Create new instances for the next buffer period.
    // Never create instances for past dates — use max(fromDate, now) so that
    // calling this with series.startsOn (potentially months ago) doesn't
    // produce call records in the past.
    const now = new Date();
    const effectiveFromDate = fromDate > now ? fromDate : now;
    const toDate = new Date(now.getTime() + INSTANCE_BUFFER_DAYS);
    const newCallIds = await createInstancesForDateRange(self, series, effectiveFromDate, toDate, tx, series.callUpdatesChannel);
    callIds.push(...newCallIds);
  });
}
export function scheduleJobsForNextInstanceTx(db: PrismaClient, seriesId: string, currentInstanceEndsAt: Date) {
  return transaction(['Call', 'CallParticipant', 'RecurringCallSeries'], 'scheduleJobsForNextInstance: series, next-instance and participant reads for job scheduling must commit atomically; tx is not ACL-wrapped', db, async (tx) => {
    const series = await repositories.recurringCallSeries.findById(seriesId, tx);

    if (!series) {
      logger.warn(`Cannot schedule next jobs: Series ${seriesId} not found`);
      return;
    }

    if (series.status !== RecurringCallSeriesStatus.ACTIVE) {
      logger.info(`Series ${seriesId} is ${series.status}, skipping job scheduling`);
      return;
    }

    // Find the next SCHEDULED instance after the current one
    const nextInstance = await findNextScheduledInstance({
      seriesId,
      afterDate: currentInstanceEndsAt,
      tx,
    });

    if (!nextInstance) {
      logger.info(`No next instance found after ${currentInstanceEndsAt.toISOString()} for series ${seriesId}`);
      return;
    }

    // Get participant IDs for this instance
    const participantUserIds = await findCallParticipantUserIds({
      callId: nextInstance.id,
      tx,
    });

    // Schedule the reminder and auto-end jobs
    try {
      await scheduledCallNotificationService.scheduleCallReminder(
        nextInstance.id,
        nextInstance.externalId,
        nextInstance.title || series.title,
        nextInstance.startsAt!,
        participantUserIds,
      );
      await scheduledCallNotificationService.scheduleCallAutoEnd(
        nextInstance.id,
        nextInstance.externalId,
        nextInstance.endsAt!,
      );

      logger.info(
        `Scheduled Bull jobs for next recurring instance ${nextInstance.id} (${nextInstance.externalId}) at ${nextInstance.startsAt!.toISOString()}`,
      );
    } catch (err) {
      logger.error(`Failed to schedule jobs for next instance ${nextInstance.id}:`, err);
    }
  });
}
export function cancelSeriesTx(db: PrismaClient, seriesId: string, now: Date) {
  return transaction(['Call', 'RecurringCallSeries'], 'cancelSeries: future-instance cancellation and series status update must commit atomically; tx is not ACL-wrapped', db, async (tx) =>
    repositories.scheduledCalls.cancelSeries({ seriesId, now, tx }),
  );
}
export function deleteSeriesTx(db: PrismaClient, seriesId: string) {
  return transaction(['Call', 'RecurringCallSeries'], 'deleteSeries: scheduled-instance cancellation and series status update must commit atomically; tx is not ACL-wrapped', db, async (tx) =>
    repositories.scheduledCalls.deleteSeries({ seriesId, tx }),
  );
}

  /**
   * Create all instances for a date range in bulk.
   * Only notifies participants for the first upcoming instance (to avoid notification spam).
   * Returns array of created call IDs.
   */
export async function createInstancesForDateRange(self: RecurringCallService, series: RecurringSeriesShape, fromDate: Date, toDate: Date, tx: Prisma.TransactionClient, callUpdatesChannel?: string | null): Promise<string[]> {
    const occurrences = self.getOccurrencesInRange(series, fromDate, toDate);
    const callIds: string[] = [];

    const now = new Date();

    for (let i = 0; i < occurrences.length; i++) {
      const startsAt = occurrences[i]!;
      const endsAt = addHHMMDuration(startsAt, series.startTime, series.endTime);

      // Only notify for the first upcoming instance (starts after now)
      const isFirstUpcoming = startsAt > now && (i === 0 || occurrences[i - 1]! <= now);

      try {
        // Only schedule Bull jobs for the FIRST instance (i === 0)
        // Subsequent instances will have their jobs created when the previous instance ends
        const scheduleJobs = i === 0;
        const callId = await self.createInstance(series, startsAt, endsAt, isFirstUpcoming, tx, scheduleJobs, callUpdatesChannel);
        callIds.push(callId);
      } catch (err) {
        logger.error(`Failed to create instance for ${startsAt.toISOString()} in series ${series.id}:`, err);
        // Continue creating other instances
      }
    }

    logger.info(`Created ${callIds.length} instances for series ${series.id} between ${fromDate.toISOString()} and ${toDate.toISOString()} (Bull jobs scheduled for first instance only)`);
    return callIds;
  }
