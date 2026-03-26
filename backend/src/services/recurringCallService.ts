import rruleLib from 'rrule';
const { RRule } = rruleLib;
import { v4 as uuidv4 } from 'uuid';
import { CallOrigin, CallType, RecurringCallSeriesStatus, type Prisma } from '@prisma/client';
import { repositories } from '@/database/repositories';
import { livekitService } from '@/services/liveKitService';
import { logger } from '@/utils/logger';
import { scheduledCallNotificationService } from '@/services/scheduledCallNotificationService';
import { addHHMMDuration } from '@/utils/dateUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RecurringSeriesShape {
  id: string;
  title: string;
  organizerId: string;
  channelId: string;
  recurrenceRule: string;
  timezone: string;
  startTime: string;
  endTime: string;
  startsOn: Date;
  endsOn: Date | null;
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
   * Schedules reminder + auto-end Bull jobs (errors are non-fatal).
   * Returns the new callId.
   */
  async createInstance(
    recurringSeries: RecurringSeriesShape,
    startsAt: Date,
    endsAt: Date,
    notifyParticipants: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const callId = uuidv4();
    const externalId = uuidv4();
    const roomLink = `${livekitService.getClientUrl()}/call/${externalId}?type=${CallType.AUDIO}`;

    const { participantUserIds } = await repositories.calls.createCallWithParticipants({
      callId,
      externalId,
      title: recurringSeries.title,
      createdByUserId: recurringSeries.organizerId,
      channelId: recurringSeries.channelId,
      callType: CallType.AUDIO,
      callOrigin: CallOrigin.CHANNEL,
      roomLink,
      timezone: recurringSeries.timezone,
      isRecurring: true,
      recurringSeriesId: recurringSeries.id,
      startsAt,
      endsAt,
    }, tx);

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

    // Schedule 10-min reminder and auto-end Bull jobs
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

    logger.info(
      `Created recurring instance ${callId} (${externalId}) for series ${recurringSeries.id} at ${startsAt.toISOString()}`,
    );
    return callId;
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
    const recurringSeries = await tx.recurringCallSeries.findUnique({ where: { id: seriesId } });

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
      await tx.recurringCallSeries.update({
        where: { id: seriesId },
        data: { status: RecurringCallSeriesStatus.ENDED, updatedAt: new Date() },
      });
      return null;
    }

    const endsAt = addHHMMDuration(nextOccurrence, recurringSeries.startTime, recurringSeries.endTime);
    return this.createInstance(recurringSeries, nextOccurrence, endsAt, notifyParticipants, tx);
  }
}

export const recurringCallService = new RecurringCallService();
