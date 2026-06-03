import { BaseRepository } from './base';
import type {
  DataSourceColumn,
  CreateDataSourceColumnInput,
  UpdateDataSourceColumnInput,
  QueryOptions,
} from '@/types/database';

export class DataSourceColumnRepository extends BaseRepository<
  DataSourceColumn,
  CreateDataSourceColumnInput,
  UpdateDataSourceColumnInput
> {
  constructor() {
    super('dataSourceColumn');
  }

  async create(data: CreateDataSourceColumnInput): Promise<DataSourceColumn> {
    return this.db.dataSourceColumn.create({ data });
  }

  async bulkCreateAndReturn(
    rows: CreateDataSourceColumnInput[],
  ): Promise<DataSourceColumn[]> {
    if (rows.length === 0) return [];
    const tableId = rows[0]!.tableId;
    for (const r of rows) {
      if (r.tableId !== tableId) {
        throw new Error(
          'bulkCreateAndReturn: all rows must share the same tableId',
        );
      }
    }
    return this.db.$transaction(async (tx) => {
      await tx.dataSourceColumn.createMany({ data: rows });
      return tx.dataSourceColumn.findMany({
        where: { tableId },
        orderBy: { columnName: 'asc' },
      });
    });
  }

  async findById(id: string): Promise<DataSourceColumn | null> {
    return this.db.dataSourceColumn.findUnique({ where: { id } });
  }

  async findByTable(tableId: string): Promise<DataSourceColumn[]> {
    return this.db.dataSourceColumn.findMany({
      where: { tableId },
      orderBy: { columnName: 'asc' },
    });
  }

  async findByTableIds(tableIds: ReadonlyArray<string>): Promise<DataSourceColumn[]> {
    if (tableIds.length === 0) return [];
    return this.db.dataSourceColumn.findMany({
      where: { tableId: { in: tableIds as string[] } },
      orderBy: [{ tableId: 'asc' }, { columnName: 'asc' }],
    });
  }

  async findMany(options?: QueryOptions): Promise<DataSourceColumn[]> {
    const { skip, take, orderBy, where } = options ?? {};
    return this.db.dataSourceColumn.findMany({ skip, take, orderBy, where });
  }

  async update(
    id: string,
    data: UpdateDataSourceColumnInput,
  ): Promise<DataSourceColumn> {
    return this.db.dataSourceColumn.update({ where: { id }, data });
  }

  async updateEdaResult(
    id: string,
    summary: string,
    cardinality: 'categorical' | 'high_card' | null,
  ): Promise<DataSourceColumn> {
    return this.db.dataSourceColumn.update({
      where: { id },
      data: { summary, cardinality },
    });
  }

  async delete(id: string): Promise<DataSourceColumn> {
    return this.db.dataSourceColumn.delete({ where: { id } });
  }
}
