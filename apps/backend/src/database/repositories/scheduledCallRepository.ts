import { DatabaseClient } from '../client';
import { type Prisma } from '@prisma/client';
import { CallStatus, RecurringCallSeriesStatus } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { queueScheduledCallPillSync } from '@/services/scheduledCallPillSync';
import { CallVespaFeedSource, queueCallVespaFeed } from '@/services/callVespaQueue';
import { CALENDAR_CALL_ORIGINS } from '@/utils/callTypeUtils';

export class ScheduledCallRepository {
  private client(tx?: Prisma.TransactionClient) {
    return tx ?? DatabaseClient.getInstance();
  }

  /**
   * Cancel a single SCHEDULED call instance by marking it as CANCELLED.
   */
  async cancelCall(callId: string): Promise<void> {
    const call = await this.client().call.update({
      where: { id: callId },
      data: { status: CallStatus.CANCELLED },
    });
    queueScheduledCallPillSync(callId, call.externalId, 'scheduledCallRepository.cancelCall');
    queueCallVespaFeed(callId, { source: CallVespaFeedSource.ScheduledCallRepositoryCancelCall });
  }

  async findFirstUpcomingSeriesInstance(params: {
    seriesId: string;
    fromDate?: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<{
    externalId: string;
    title: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
  } | null> {
    const { seriesId, fromDate = new Date(), tx } = params;

    return this.client(tx).call.findFirst({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt: { gte: fromDate },
      },
      select: {
        externalId: true,
        title: true,
        startsAt: true,
        endsAt: true,
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Cancel an entire recurring series.
   * Marks all future SCHEDULED instances as CANCELLED and marks the series as CANCELLED.
   * Returns the number of future instances that were cancelled.
   */
  async cancelSeries(params: {
    seriesId: string;
    now: Date;
    tx: Prisma.TransactionClient;
  }): Promise<{ cancelledCalls: number }> {
    const { seriesId, now, tx } = params;

    // Mark all future SCHEDULED instances as CANCELLED
    const result = await tx.call.updateMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt: { gt: now },
      },
      data: { status: CallStatus.CANCELLED },
    });

    // Mark the series itself as CANCELLED
    await tx.recurringCallSeries.update({
      where: { id: seriesId },
      data: { status: RecurringCallSeriesStatus.CANCELLED, updatedAt: new Date() },
    });

    logger.info(
      `Cancelled series ${seriesId}: ${result.count} future instances marked CANCELLED`,
    );

    return { cancelledCalls: result.count };
  }

  /**
   * Soft-delete an entire recurring series (admin use).
   * Marks all SCHEDULED instances as CANCELLED (preserves COMPLETED and other final-state calls).
   * Participants are not deleted as they remain associated with the call records.
   * The series is marked CANCELLED. Use cancelSeries() for user-facing cancellation.
   */
  async deleteSeries(params: {
    seriesId: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ deletedCalls: number }> {
    const { seriesId, tx } = params;

    // Mark all SCHEDULED instances as CANCELLED (preserves COMPLETED/HANGUP calls for history)
    const result = await tx.call.updateMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
      },
      data: { status: CallStatus.CANCELLED },
    });

    if (result.count > 0) {
      logger.info(
        `Cancelled ${result.count} scheduled instances for series ${seriesId}`,
      );
    }

    // Mark the series as CANCELLED
    await tx.recurringCallSeries.update({
      where: { id: seriesId },
      data: { status: RecurringCallSeriesStatus.CANCELLED, updatedAt: new Date() },
    });

    logger.info(
      `Deleted series ${seriesId}: ${result.count} scheduled calls marked CANCELLED, completed calls preserved`,
    );

    return { deletedCalls: result.count };
  }

  /**
   * Find all call instances (id + externalId) for a series.
   */
  async findCallsBySeriesId(params: {
    seriesId: string;
    tx: Prisma.TransactionClient;
  }): Promise<Array<{ id: string; externalId: string }>> {
    const { seriesId, tx } = params;
    return tx.call.findMany({
      where: { recurringSeriesId: seriesId },
      select: { id: true, externalId: true },
    });
  }

  /**
   * Find future SCHEDULED call instances (id + externalId) for a series.
   */
  async findFutureScheduledCalls(params: {
    seriesId: string;
    now: Date;
    tx: Prisma.TransactionClient;
  }): Promise<Array<{ id: string; externalId: string }>> {
    const { seriesId, now, tx } = params;
    return tx.call.findMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt: { gt: now },
      },
      select: { id: true, externalId: true },
    });
  }

  /**
   * Find all SCHEDULED call instances for a series.
   */
  async findScheduledInstances(params: {
    seriesId: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string; externalId: string; startsAt: Date | null; endsAt: Date | null; metadata: unknown }[]> {
    const { seriesId, tx } = params;
    return tx.call.findMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
      },
      select: { id: true, externalId: true, startsAt: true, endsAt: true, metadata: true },
    });
  }

  async updateScheduledInstanceTimes(params: {
    callId: string;
    startsAt: Date;
    endsAt: Date;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const { callId, startsAt, endsAt, tx } = params;

    await this.client(tx).call.update({
      where: { id: callId },
      data: { startsAt, endsAt },
    });
  }

  async updateScheduledInstanceFields(params: {
    callIds: string[];
    title?: string | null;
    channelId?: string | null;
    callUpdatesChannel?: string | null;
    summaryTemplateId?: string | null;
    tx?: Prisma.TransactionClient;
  }): Promise<number> {
    const { callIds, title, channelId, callUpdatesChannel, summaryTemplateId, tx } = params;
    if (callIds.length === 0) return 0;

    const data: Prisma.CallUncheckedUpdateManyInput = {};
    if (title !== undefined) data.title = title;
    if (channelId !== undefined) data.channelId = channelId;
    if (callUpdatesChannel !== undefined) data.callUpdatesChannel = callUpdatesChannel;
    if (summaryTemplateId !== undefined) data.summaryTemplateId = summaryTemplateId;

    if (Object.keys(data).length === 0) return 0;

    const result = await this.client(tx).call.updateMany({
      where: { id: { in: callIds } },
      data,
    });

    return result.count;
  }

  /**
   * A series' SCHEDULED instances other than `excludeCallId`: what a series-wide owner
   * change moves besides the call it was started from. `ownedBy` narrows it to one owner's.
   */
  async findOtherScheduledInstances(seriesId: string, excludeCallId: string, ownedBy?: string) {
    return this.client().call.findMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        id: { not: excludeCallId },
        callOrigin: { notIn: [...CALENDAR_CALL_ORIGINS] },
        ...(ownedBy ? { createdByUserId: ownedBy } : {}),
      },
      select: { id: true, externalId: true, status: true, callOrigin: true, metadata: true, transcript: true },
    });
  }

  /**
   * The next upcoming SCHEDULED instance of each given series, in one query
   * (`distinct` keeps the first row per series of the startsAt-ascending order).
   */
  async findNextScheduledInstancesBySeriesIds(
    seriesIds: string[],
    now: Date,
  ): Promise<Array<{ recurringSeriesId: string | null; externalId: string; startsAt: Date | null }>> {
    if (seriesIds.length === 0) return [];
    return this.client().call.findMany({
      where: {
        recurringSeriesId: { in: seriesIds },
        status: CallStatus.SCHEDULED,
        startsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      distinct: ['recurringSeriesId'],
      select: { recurringSeriesId: true, externalId: true, startsAt: true },
    });
  }
}
