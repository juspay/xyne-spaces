import rruleLib from 'rrule';
const { RRule } = rruleLib;
import { v4 as uuidv4 } from 'uuid';
import { type Call, type Prisma } from '@prisma/client';
import { CallOrigin, CallType, RecurringCallSeriesStatus } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { addHHMMDuration } from '@/utils/dateUtils';
import { DatabaseClient } from '@/database/client';
import { CallVespaFeedSource, queueCallVespaFeed } from '@/services/callVespaQueue';
import { queueCallCalendarPush, queueCallCalendarPushMany } from '@/queues/callCalendarPushQueue';
import { runWithContext } from '@/database/tenant/context';
import { buildCallInviteUrl } from '@/utils/urlUtils';
import { replenishInstanceBufferTx } from '@/bypassAcl/transactions/recurringCallService';
import { regenerateFutureInstancesTx } from '@/bypassAcl/transactions/recurringCallService';
import { scheduleJobsForNextInstanceTx } from '@/bypassAcl/transactions/recurringCallService';
import { cancelSeriesTx } from '@/bypassAcl/transactions/recurringCallService';
import { deleteSeriesTx } from '@/bypassAcl/transactions/recurringCallService';

// Number of milliseconds to buffer recurring call instances ahead of time (60 days)
export const INSTANCE_BUFFER_DAYS = 60 * 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecurringSeriesShape {
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
  summaryTemplateId?: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class RecurringCallService {
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
        ...(recurringSeries.summaryTemplateId && { summaryTemplateId: recurringSeries.summaryTemplateId }),
      }, tx);

      queueCallVespaFeed(callId, { source: CallVespaFeedSource.RecurringCallServiceCreateInstance });
      // Every materialized instance — first creation, buffer replenishment,
      // regeneration, the auto-end chain — passes through here, so this one
      // hook puts the whole series on the organizer's calendar.
      queueCallCalendarPush(callId, externalId, 'recurringCallService.createInstance');

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
          logger.error(`Failed to send scheduled notifications for recurring instance ${externalId}:`, err);
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
          logger.error(`Failed to schedule jobs for recurring instance ${externalId}:`, err);
        }
      }

      logger.info(
        `Created recurring instance ${externalId} for series ${recurringSeries.id} at ${startsAt.toISOString()}`,
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
   * Replenish the buffer of SCHEDULED instances to maintain the 60-day target.
   * Called when an instance is consumed (auto-end) or deleted.
   */
  async replenishInstanceBuffer(seriesId: string): Promise<void> {
    const db = DatabaseClient.getInstance();

    await replenishInstanceBufferTx(db, seriesId, this);
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
        await scheduledCallNotificationService.removeCallJobs(instance.id, instance.externalId);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for instance ${instance.externalId}:`, err);
      }
    }

    // Soft-delete: mark existing scheduled instances as CANCELLED instead of hard-deleting
    const scheduledInstanceIds = allScheduledInstances.map((i) => i.id);

    await regenerateFutureInstancesTx(db, scheduledInstanceIds, series, fromDate, this, callIds);

    scheduledInstanceIds.forEach((callId) => queueCallVespaFeed(callId, {
      source: CallVespaFeedSource.RecurringCallServiceRegenerateFutureInstancesCancelledInstance,
    }));
    // The replacements were pushed by createInstance; these are the instances
    // the new rule superseded, so withdraw their calendar events.
    queueCallCalendarPushMany(
      allScheduledInstances,
      'recurringCallService.regenerateFutureInstances',
    );

    return callIds;
  }

  /**
   * Schedule Bull jobs for the NEXT instance after the given instance ended.
   * Called from the auto-end handler to create jobs just-in-time.
   */
  async scheduleJobsForNextInstance(seriesId: string, currentInstanceEndsAt: Date): Promise<void> {
    const db = DatabaseClient.getInstance();

    await scheduleJobsForNextInstanceTx(db, seriesId, currentInstanceEndsAt);
  }

  /**
   * Cancel a single SCHEDULED call (a one-off or one instance of a series) and run its
   * side effects: remove its Bull jobs, mark it CANCELLED (record preserved), withdraw
   * the mirrored calendar event, and for a series instance replenish the buffer and
   * hand the Bull job chain to the next instance. Callers own the permission and
   * status checks; `context` labels the calendar push for tracing.
   */
  async cancelScheduledCall(
    call: Pick<Call, 'id' | 'externalId' | 'recurringSeriesId' | 'endsAt'>,
    context: string,
  ): Promise<void> {
    // Remove Bull jobs for this instance
    try {
      await scheduledCallNotificationService.removeCallJobs(call.id, call.externalId);
    } catch (err) {
      logger.error(`Failed to remove Bull jobs for call ${call.externalId}:`, err);
    }

    // Mark the instance as CANCELLED (preserve record)
    await repositories.scheduledCalls.cancelCall(call.id);

    // Withdraw the mirrored calendar event so attendees' calendars clear too.
    queueCallCalendarPush(call.id, call.externalId, context);

    // Trigger buffer replenishment for recurring series
    if (call.recurringSeriesId) {
      try {
        await this.replenishInstanceBuffer(call.recurringSeriesId);
        logger.info(`Buffer replenished for series ${call.recurringSeriesId} after instance cancellation`);
      } catch (err) {
        logger.error(`Failed to replenish buffer for series ${call.recurringSeriesId}:`, err);
      }

      // Transfer the Bull job chain to the next instance.
      // Instances beyond the first are created without Bull jobs (scheduleJobs=false),
      // relying on the previous instance's auto-end job to call scheduleJobsForNextInstance.
      // When that previous instance is cancelled instead of auto-ended, the chain is broken
      // and the next instance never gets its auto-end job — leaving it stuck in SCHEDULED.
      if (call.endsAt) {
        try {
          await this.scheduleJobsForNextInstance(call.recurringSeriesId, call.endsAt);
          logger.info(`Bull jobs transferred to next instance in series ${call.recurringSeriesId}`);
        } catch (err) {
          logger.error(`Failed to schedule jobs for next instance in series ${call.recurringSeriesId}:`, err);
        }
      }
    }
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
    const futureInstances = await repositories.scheduledCalls.findFutureScheduledCalls({
      seriesId,
      now,
      tx: db,
    });
    const futureInstanceIds = futureInstances.map((instance) => instance.id);

    // Step 2: Remove Bull jobs outside the transaction (Redis calls should not
    // live inside a Prisma transaction as they can cause timeouts).
    for (const instance of futureInstances) {
      try {
        await scheduledCallNotificationService.removeCallJobs(instance.id, instance.externalId);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for instance ${instance.externalId}:`, err);
      }
    }

    // Step 3: Atomically mark instances + series as CANCELLED via ScheduledCallRepository.
    const result = await cancelSeriesTx(db, seriesId, now);

    queueCallCalendarPushMany(futureInstances, 'recurringCallService.cancelSeries');
    futureInstanceIds.forEach((instanceId) =>
      queueCallVespaFeed(instanceId, { source: CallVespaFeedSource.RecurringCallServiceCancelSeries }),
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
    const instances = await repositories.scheduledCalls.findCallsBySeriesId({
      seriesId,
      tx: db,
    });
    const instanceIds = instances.map((instance) => instance.id);

    for (const instance of instances) {
      try {
        await scheduledCallNotificationService.removeCallJobs(instance.id, instance.externalId);
      } catch (err) {
        logger.error(`Failed to remove Bull jobs for instance ${instance.externalId}:`, err);
      }
    }

    const result = await deleteSeriesTx(db, seriesId);

    queueCallCalendarPushMany(instances, 'recurringCallService.deleteSeries');
    instanceIds.forEach((instanceId) =>
      queueCallVespaFeed(instanceId, { source: CallVespaFeedSource.RecurringCallServiceDeleteSeries }),
    );

    return result;
  }
}

export const recurringCallService = new RecurringCallService();





