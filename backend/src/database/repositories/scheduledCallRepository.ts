import { DatabaseClient } from '../client';
import { CallStatus, RecurringCallSeriesStatus, type Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

export class ScheduledCallRepository {
  /**
   * Cancel a single SCHEDULED call instance by marking it as CANCELLED.
   */
  async cancelCall(callId: string): Promise<void> {
    await DatabaseClient.getInstance().call.update({
      where: { id: callId },
      data: { status: CallStatus.CANCELLED },
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
   * Find all call instance IDs for a series.
   */
  async findCallIdsBySeriesId(params: {
    seriesId: string;
    tx: Prisma.TransactionClient;
  }): Promise<string[]> {
    const { seriesId, tx } = params;
    const instances = await tx.call.findMany({
      where: { recurringSeriesId: seriesId },
      select: { id: true },
    });
    return instances.map((i) => i.id);
  }

  /**
   * Find future SCHEDULED call instance IDs for a series.
   */
  async findFutureScheduledCallIds(params: {
    seriesId: string;
    now: Date;
    tx: Prisma.TransactionClient;
  }): Promise<string[]> {
    const { seriesId, now, tx } = params;
    const instances = await tx.call.findMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt: { gt: now },
      },
      select: { id: true },
    });
    return instances.map((i) => i.id);
  }

  /**
   * Find all SCHEDULED call instances for a series.
   */
  async findScheduledInstances(params: {
    seriesId: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string; externalId: string; startsAt: Date | null; endsAt: Date | null }[]> {
    const { seriesId, tx } = params;
    return tx.call.findMany({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
      },
      select: { id: true, externalId: true, startsAt: true, endsAt: true },
    });
  }

  /**
   * Count future SCHEDULED instances from a given date.
   */
  async countFutureScheduledInstances(params: {
    seriesId: string;
    fromDate: Date;
    tx: Prisma.TransactionClient;
  }): Promise<number> {
    const { seriesId, fromDate, tx } = params;
    return tx.call.count({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt: { gte: fromDate },
      },
    });
  }

  /**
   * Check if a SCHEDULED instance already exists at a specific time.
   */
  async findExistingInstanceAt(params: {
    seriesId: string;
    startsAt: Date;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string } | null> {
    const { seriesId, startsAt, tx } = params;
    return tx.call.findFirst({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt,
      },
      select: { id: true },
    });
  }

  /**
   * Find the last SCHEDULED instance to determine where to start creating new ones.
   */
  async findLastScheduledInstance(params: {
    seriesId: string;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string; startsAt: Date | null } | null> {
    const { seriesId, tx } = params;
    return tx.call.findFirst({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
      },
      orderBy: { startsAt: 'desc' },
      select: { id: true, startsAt: true },
    });
  }

  /**
   * Find the next SCHEDULED instance after a given date.
   * Used to create Bull jobs for the next instance when the current one ends.
   */
  async findNextScheduledInstance(params: {
    seriesId: string;
    afterDate: Date;
    tx: Prisma.TransactionClient;
  }): Promise<{ id: string; externalId: string; title: string | null; startsAt: Date | null; endsAt: Date | null } | null> {
    const { seriesId, afterDate, tx } = params;
    return tx.call.findFirst({
      where: {
        recurringSeriesId: seriesId,
        status: CallStatus.SCHEDULED,
        startsAt: { gt: afterDate },
      },
      orderBy: { startsAt: 'asc' },
      select: { id: true, externalId: true, title: true, startsAt: true, endsAt: true },
    });
  }

  /**
   * Find participant user IDs for a call instance.
   */
  async findCallParticipantUserIds(params: {
    callId: string;
    tx: Prisma.TransactionClient;
  }): Promise<string[]> {
    const { callId, tx } = params;
    const participants = await tx.callParticipant.findMany({
      where: { callId },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }
}
