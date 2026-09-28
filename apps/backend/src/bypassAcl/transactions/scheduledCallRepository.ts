import { Prisma } from '@prisma/client';
import { CallStatus } from '@xyne/shared';

  /**
   * Count future SCHEDULED instances from a given date.
   */
export async function countFutureScheduledInstances(params: {
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
export async function findExistingInstanceAt(params: {
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
export async function findLastScheduledInstance(params: {
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
export async function findNextScheduledInstance(params: {
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
export async function findCallParticipantUserIds(params: {
    callId: string;
    tx: Prisma.TransactionClient;
  }): Promise<string[]> {
    const { callId, tx } = params;
    const participants = await tx.callParticipant.findMany({
      where: { callId, isExternal: false },
      select: { userId: true },
    });
    return participants.map((p) => p.userId);
  }
