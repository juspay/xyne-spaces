import { type Prisma, type RecurringCallSeries } from '@prisma/client';
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
}
