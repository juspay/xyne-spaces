import { type Prisma, type RecurringCallSeries } from '@prisma/client';
import type { RecurringCallSeriesStatus } from '@xyne/shared';
import { DatabaseClient } from '../client';

export class RecurringCallSeriesRepository {
  private client(tx?: Prisma.TransactionClient) {
    return tx ?? DatabaseClient.getInstance();
  }

  async create(
    data: Prisma.RecurringCallSeriesUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<RecurringCallSeries> {
    return this.client(tx).recurringCallSeries.create({ data });
  }

  async findById(
    seriesId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RecurringCallSeries | null> {
    return this.client(tx).recurringCallSeries.findUnique({
      where: { id: seriesId },
    });
  }

  async update(
    seriesId: string,
    data: Prisma.RecurringCallSeriesUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<RecurringCallSeries> {
    return this.client(tx).recurringCallSeries.update({
      where: { id: seriesId },
      data,
    });
  }

  /**
   * Calls admin panel list of series, newest first, cursor-paged on (createdAt, id).
   * `participantUserId` narrows it to series that user organizes or is invited to
   * (the panel's SELF tier).
   */
  async findForAdminList(
    filters: {
      workspaceId: string;
      participantUserId?: string;
      statuses?: RecurringCallSeriesStatus[];
      organizerId?: string;
      search?: string;
    },
    options: { limit: number; cursor?: { createdAt: Date; id: string } },
  ): Promise<{ series: RecurringCallSeries[]; nextCursor: { createdAt: Date; id: string } | null }> {
    const conditions: Prisma.RecurringCallSeriesWhereInput[] = [{ workspaceId: filters.workspaceId }];

    if (filters.participantUserId) {
      conditions.push({
        OR: [
          { organizerId: filters.participantUserId },
          { participants: { some: { userId: filters.participantUserId } } },
        ],
      });
    }
    if (filters.statuses?.length) conditions.push({ status: { in: filters.statuses } });
    if (filters.organizerId) conditions.push({ organizerId: filters.organizerId });
    if (filters.search) {
      conditions.push({
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { id: filters.search },
        ],
      });
    }
    if (options.cursor) {
      conditions.push({
        OR: [
          { createdAt: { lt: options.cursor.createdAt } },
          { createdAt: options.cursor.createdAt, id: { lt: options.cursor.id } },
        ],
      });
    }

    // Fetch one extra to determine if there is a next page
    const series = await this.client().recurringCallSeries.findMany({
      where: { AND: conditions },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit + 1,
    });

    let nextCursor: { createdAt: Date; id: string } | null = null;
    if (series.length > options.limit) {
      series.pop(); // discard the sentinel item (not part of the current page)
      const lastInPage = series[series.length - 1];
      nextCursor = { createdAt: lastInPage.createdAt, id: lastInPage.id };
    }

    return { series, nextCursor };
  }
}
