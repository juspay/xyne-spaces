import rruleLib from 'rrule';
const { RRule } = rruleLib;
import { v4 as uuidv4 } from 'uuid';
import { type Prisma } from '@prisma/client';
import { CallOrigin, CallStatus, CallType, RecurringCallSeriesStatus } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { addHHMMDuration } from '@/utils/dateUtils';
import { DatabaseClient } from '@/database/client';
import { CallVespaFeedSource, queueCallVespaFeed } from '@/services/callVespaQueue';
import { runWithContext } from '@/database/tenant/context';
import { buildCallInviteUrl } from '@/utils/urlUtils';

// Number of milliseconds to buffer recurring call instances ahead of time (60 days)
const INSTANCE_BUFFER_DAYS = 60 * 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecurringSeriesShape {
  id: string;
  workspaceId: string | null;
  title: string;
  organizerId: string;
  channelId: string;
  recurrenceRule: string;
  timezone: string;
  startTime: string;
  endTime: string;
  startsOn: Date;
  endsOn: Date | null;
  callUpdatesChannel: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

class RecurringCallService {
  /**
   * Return the next occurrence of the series strictly after `after`.
   * Pass inclusive=true to include `after` itself.
   * Returns null when: no more occurrences exist, or endsOn has passed.
   */
  getNextOccurrence(recurringSeries: RecurringSeriesShape, after: Date, inclusive = false): Date | null {
    // series.startsOn is already the correct UTC epoch (frontend sent data.startsAt.getTime()).
    // Using it directly as dtstart means RRule generates all occurrences at the same
    // UTC offset, preserving the user's local time correctly.
    const options = RRule.parseString(recurringSeries.recurrenceRule);
    options.dtstart = recurringSeries.startsOn;
    const rule = new RRule(options);
    const next = rule.after(after, inclusive);
    if (!next) return null;
    if (recurringSeries.endsOn && next > new Date(recurringSeries.endsOn)) return null;
    return next;
  }

  /**
   * Create a single Call instance for a series occurrence.
   * Optionally schedules reminder + auto-end Bull jobs (errors are non-fatal).
   * Set scheduleJobs=false when bulk-creating instances to only create jobs for the first one.
   * Returns the new callId.
   */
  async createInstance(
    recurringSeries: RecurringSeriesShape,
    startsAt: Date,
    endsAt: Date,
    notifyParticipants: boolean,
    tx: Prisma.TransactionClient,
    scheduleJobs = true,
    callUpdatesChannel?: string | null,
  ): Promise<string> {
    const callId = uuidv4();
    const externalId = uuidv4();
    const roomLink = buildCallInviteUrl(externalId);
    const { targetUserIds, participantInviters, externalInvitees } =
      await repositories.recurringCallParticipants.findInstanceSeed(recurringSeries.id, tx);

    // Background schedulers (callValidationWorker setInterval, scheduledCallNotificationService
    // Bull handler) open no HTTP tenant scope, and RecurringCallSeries.workspaceId is nullable.
    // Resolve a guaranteed-non-null workspaceId from the series' channel (Channel.workspaceId is
    // NOT NULL) and open a tenant context so the call insert AND the sibling callParticipant
    // createMany (which carries no explicit workspaceId) both get stamped instead of leaking NULL.
    let workspaceId = recurringSeries.workspaceId;
    if (!workspaceId) {
      const channel = await tx.channel.findUnique({
        where: { id: recurringSeries.channelId },
        select: { workspaceId: true },
      });
      workspaceId = channel?.workspaceId ?? null;
    }
    if (!workspaceId) {
      logger.error('Recurring series has no resolvable workspaceId', {
        seriesId: recurringSeries.id,
        channelId: recurringSeries.channelId,
      });
      throw new Error(`recurringCallService: no resolvable workspaceId for series ${recurringSeries.id} (channel ${recurringSeries.channelId})`);
    }

    return runWithContext({ userId: recurringSeries.organizerId, workspaceId }, async () => {
      const { participantUserIds } = await repositories.calls.createCallWithParticipants({
        callId,
        externalId,
        title: recurringSeries.title,
        createdByUserId: recurringSeries.organizerId,
        workspaceId: workspaceId ?? undefined,
        channelId: recurringSeries.channelId,
        callType: CallType.AUDIO,
        callOrigin: CallOrigin.CHANNEL,
        roomLink,
        timezone: recurringSeries.timezone,
        isRecurring: true,
        recurringSeriesId: recurringSeries.id,
        startsAt,
        endsAt,
        targetUserIds,
        participantInviters,
        ...(externalInvitees.length > 0 && { externalInvitees }),
        callUpdatesChannel: callUpdatesChannel ?? null,
      }, tx);

      queueCallVespaFeed(callId, { source: CallVespaFeedSource.RecurringCallServiceCreateInstance });

      // Send immediate CALL_SCHEDULED notifications + activities for the first instance only
      if (notifyParticipants) {
        try {
          await scheduledCallNotificationService.sendScheduledCallNotifications({
            callId,
            callExternalId: externalId,
            title: recurringSeries.title,
            startsAt,
            endsAt,
            channelId: recurringSeries.channelId,
            organizerUserId: recurringSeries.organizerId,
            participantUserIds,
          });
        } catch (err) {
          logger.error(`Failed to send scheduled notifications for recurring instance ${callId}:`, err);
        }
      }

      // Schedule 10-min reminder and auto-end Bull jobs (only if requested)
      if (scheduleJobs) {
        try {
          await scheduledCallNotificationService.scheduleCallReminder(
            callId,
            externalId,
            recurringSeries.title,
            startsAt,
            participantUserIds,
          );
          await scheduledCallNotificationService.scheduleCallAutoEnd(callId, externalId, endsAt);
        } catch (err) {
          logger.error(`Failed to schedule jobs for recurring instance ${callId}:`, err);
        }
      }

      logger.info(
        `Created recurring instance ${callId} (${externalId}) for series ${recurringSeries.id} at ${startsAt.toISOString()}`,
      );
      return callId;
    });
  }

  /**
   * Create the next (or first) instance for a series.
   *
   * Pass `inclusive = true` when creating the first instance so that
   * `afterDate` itself (i.e. `startsOn`) is eligible as an occurrence.
   * Pass `inclusive = false` (default) when chaining from an auto-end job
   * so the current occurrence is not repeated.
   *
   * Marks the series as ENDED when no further occurrences exist.
   */
  async createNextInstance(
    seriesId: string,
    afterDate: Date,
    inclusive: boolean,
    notifyParticipants: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<string | null> {
    const recurringSeries = await repositories.recurringCallSeries.findById(seriesId, tx);

    if (!recurringSeries) {
      logger.warn(`RecurringCallSeries ${seriesId} not found`);
      return null;
    }

    if (recurringSeries.status !== RecurringCallSeriesStatus.ACTIVE) {
      logger.info(`Series ${seriesId} is ${recurringSeries.status}, skipping instance creation`);
      return null;
    }

    const nextOccurrence = this.getNextOccurrence(recurringSeries, afterDate, inclusive);

    if (!nextOccurrence) {
      logger.info(`Series ${seriesId} has no more occurrences — marking as ENDED`);
      await repositories.recurringCallSeries.update(
        seriesId,
        { status: RecurringCallSeriesStatus.ENDED, updatedAt: new Date() },
        tx,
      );
      return null;
    }

    const endsAt = addHHMMDuration(nextOccurrence, recurringSeries.startTime, recurringSeries.endTime);

    return this.createInstance(recurringSeries, nextOccurrence, endsAt, notifyParticipants, tx, true, recurringSeries.callUpdatesChannel);
  }

  /**
   * Calculate all occurrences within a date range using the series recurrence rule.
   * Returns dates >= fromDate and <= toDate, capped at 60 days from now or series.endsOn.
   */
  getOccurrencesInRange(
    series: RecurringSeriesShape,
    fromDate: Date,
    toDate: Date,
  ): Date[] {
    const options = RRule.parseString(series.recurrenceRule);
    options.dtstart = series.startsOn;
    const rule = new RRule(options);

    // Cap at buffer period from now or series endsOn, whichever is earlier
    const maxDate = new Date(Date.now() + INSTANCE_BUFFER_DAYS);
    const effectiveEndDate = series.endsOn && series.endsOn < maxDate ? series.endsOn : maxDate;
    const finalToDate = toDate < effectiveEndDate ? toDate : effectiveEndDate;

    // Get all occurrences between fromDate and finalToDate (inclusive)
    // Use inclusive=true to include the fromDate if it matches the rule
    const occurrences = rule.between(fromDate, finalToDate, true);

    return occurrences.filter((date) => date >= fromDate && date <= finalToDate);
  }

  /**
   * Calculate the target instance count for maintaining a 60-day buffer.
   * This is the number of SCHEDULED instances we should always have.
   */
  calculateTargetInstanceCount(series: RecurringSeriesShape): number {
    const now = new Date();
    const bufferEndDate = new Date(now.getTime() + INSTANCE_BUFFER_DAYS);
    const endDate = series.endsOn && series.endsOn < bufferEndDate ? series.endsOn : bufferEndDate;

    const occurrences = this.getOccurrencesInRange(series, now, endDate);
    return occurrences.length;
  }

  /**
   * Create all instances for a date range in bulk.
   * Only notifies participants for the first upcoming instance (to avoid notification spam).
   * Returns array of created call IDs.
   */
  async createInstancesForDateRange(
    series: RecurringSeriesShape,
    fromDate: Date,
    toDate: Date,
    tx: Prisma.TransactionClient,
    callUpdatesChannel?: string | null,
  ): Promise<string[]> {
    const occurrences = this.getOccurrencesInRange(series, fromDate, toDate);
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
        const callId = await this.createInstance(series, startsAt, endsAt, isFirstUpcoming, tx, scheduleJobs, callUpdatesChannel);
        callIds.push(callId);
      } catch (err) {
        logger.error(`Failed to create instance for ${startsAt.toISOString()} in series ${series.id}:`, err);
        // Continue creating other instances
      }
    }

    logger.info(`Created ${callIds.length} instances for series ${series.id} between ${fromDate.toISOString()} and ${toDate.toISOString()} (Bull jobs scheduled for first instance only)`);
    return callIds;
  }

  /**
   * Replenish the buffer of SCHEDULED instances to maintain the 60-day target.
   * Called when an instance is consumed (auto-end) or deleted.
   */
  async replenishInstanceBuffer(seriesId: string): Promise<void> {
    const db = DatabaseClient.getInstance();

    await db.$transaction(async (tx) => {
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
      const scheduledCount = await repositories.scheduledCalls.countFutureScheduledInstances({
        seriesId,
        fromDate: new Date(),
        tx,
      });

      // Calculate target count (60 days worth from now)
      const targetCount = this.calculateTargetInstanceCount(series);

      if (scheduledCount >= targetCount) {
        logger.info(`Buffer is full for series ${seriesId}: ${scheduledCount}/${targetCount} instances`);
        return;
      }

      // Find the last scheduled instance to determine where to start creating new ones
      const lastScheduledInstance = await repositories.scheduledCalls.findLastScheduledInstance({
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
        const nextOccurrence = this.getNextOccurrence(series, lastDate);
        if (!nextOccurrence) break; // No more occurrences in the series

        // Idempotency: skip only if a SCHEDULED instance already exists at this exact time.
        // CANCELLED instances should NOT block replenishment — a cancelled instance at the
        // same date/slot means we still need to create a replacement.
        const existing = await repositories.scheduledCalls.findExistingInstanceAt({
          seriesId,
          startsAt: nextOccurrence,
          tx,
        });

        if (!existing) {
          const endsAt = addHHMMDuration(nextOccurrence, series.startTime, series.endTime);
          // Don't schedule jobs during replenishment - jobs are created on instance end
          await this.createInstance(series, nextOccurrence, endsAt, false, tx, false, series.callUpdatesChannel);
          createdCount++;
        }

        lastDate = nextOccurrence;
      }

      logger.info(`Replenished buffer for series ${seriesId}: created ${createdCount} instances (${scheduledCount} → ${scheduledCount + createdCount})`);
    });
  }

  /**
   * Regenerate ALL SCHEDULED instances for a series when the recurrence pattern changes.
   * When the recurrence rule changes, ALL existing SCHEDULED instances are marked as CANCELLED
   * (soft-delete) and new instances are regenerated so they all follow the new rule consistently.
   * Preserves COMPLETED and other final-state calls.
   */
  async regenerateFutureInstances(
    series: RecurringSeriesShape,
    fromDate: Date,
  ): Promise<string[]> {
    const db = DatabaseClient.getInstance();
    const callIds: string[] = [];

    // Use ScheduledCallRepository to find all SCHEDULED instances
    const allScheduledInstances = await repositories.scheduledCalls.findScheduledInstances({
      seriesId: series.id,
      tx: db,
    });

    // Remove Bull jobs BEFORE the transaction to avoid Redis calls inside a DB transaction
    for (const instance of allScheduledInstances) {
      try {
        await scheduledCallNotificationService.removeCallJobs(instance.id);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for instance ${instance.id}:`, err);
      }
    }

    // Soft-delete: mark existing scheduled instances as CANCELLED instead of hard-deleting
    const scheduledInstanceIds = allScheduledInstances.map((i) => i.id);

    await db.$transaction(async (tx) => {
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
      const newCallIds = await this.createInstancesForDateRange(series, effectiveFromDate, toDate, tx, series.callUpdatesChannel);
      callIds.push(...newCallIds);
    });

    scheduledInstanceIds.forEach((callId) => queueCallVespaFeed(callId, {
      source: CallVespaFeedSource.RecurringCallServiceRegenerateFutureInstancesCancelledInstance,
    }));

    return callIds;
  }

  /**
   * Schedule Bull jobs for the NEXT instance after the given instance ended.
   * Called from the auto-end handler to create jobs just-in-time.
   */
  async scheduleJobsForNextInstance(seriesId: string, currentInstanceEndsAt: Date): Promise<void> {
    const db = DatabaseClient.getInstance();

    await db.$transaction(async (tx) => {
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
      const nextInstance = await repositories.scheduledCalls.findNextScheduledInstance({
        seriesId,
        afterDate: currentInstanceEndsAt,
        tx,
      });

      if (!nextInstance) {
        logger.info(`No next instance found after ${currentInstanceEndsAt.toISOString()} for series ${seriesId}`);
        return;
      }

      // Get participant IDs for this instance
      const participantUserIds = await repositories.scheduledCalls.findCallParticipantUserIds({
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

  /**
   * Cancel an entire recurring series (user-facing action).
   * Marks all future SCHEDULED instances as CANCELLED (preserves records),
   * removes their Bull jobs, and marks the series as CANCELLED.
   * Buffer replenishment will stop because of the series status check.
   */
  async cancelSeries(seriesId: string): Promise<{ cancelledCalls: number }> {
    const db = DatabaseClient.getInstance();
    const now = new Date();

    // Step 1: Collect instance IDs that need their Bull jobs removed.
    // Do this BEFORE the transaction so we don't hold a DB connection while
    // making external Redis calls.
    const futureInstanceIds = await repositories.scheduledCalls.findFutureScheduledCallIds({
      seriesId,
      now,
      tx: db,
    });

    // Step 2: Remove Bull jobs outside the transaction (Redis calls should not
    // live inside a Prisma transaction as they can cause timeouts).
    for (const instanceId of futureInstanceIds) {
      try {
        await scheduledCallNotificationService.removeCallJobs(instanceId);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for instance ${instanceId}:`, err);
      }
    }

    // Step 3: Atomically mark instances + series as CANCELLED via ScheduledCallRepository.
    const result = await db.$transaction(async (tx) =>
      repositories.scheduledCalls.cancelSeries({ seriesId, now, tx }),
    );

    return result;
  }

  /**
   * Soft-delete an entire recurring series (admin use).
   * Removes Bull jobs from all instances, marks all SCHEDULED instances as CANCELLED
   * (preserves COMPLETED and other final-state calls for history), and marks the series as CANCELLED.
   */
  async deleteSeries(seriesId: string): Promise<{ deletedCalls: number }> {
    const db = DatabaseClient.getInstance();

    // Remove Bull jobs outside the transaction to avoid Redis calls inside DB transaction
    const instanceIds = await repositories.scheduledCalls.findCallIdsBySeriesId({
      seriesId,
      tx: db,
    });

    for (const instanceId of instanceIds) {
      try {
        await scheduledCallNotificationService.removeCallJobs(instanceId);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for instance ${instanceId}:`, err);
      }
    }

    return db.$transaction(async (tx) =>
      repositories.scheduledCalls.deleteSeries({ seriesId, tx }),
    );
  }
}

export const recurringCallService = new RecurringCallService();
