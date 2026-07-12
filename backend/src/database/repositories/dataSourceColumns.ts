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

  async syncForTable(
    tableId: string,
    cols: Array<{
      columnName: string;
      pkPosition: number | null;
      dataTypeNative: string;
      dataTypeCanonical: string;
      isNullable: boolean;
      isPrimaryKey: boolean;
    }>
  ): Promise<DataSourceColumn[]> {
    await this.db.dataSourceColumn.deleteMany({
      where: { tableId, columnName: { notIn: cols.map((c) => c.columnName) } },
    });
    await this.db.$transaction(
      cols.map((c) =>
        this.db.dataSourceColumn.upsert({
          where: { tableId_columnName: { tableId, columnName: c.columnName } },
          create: { ...c, tableId, pkPosition: c.pkPosition ?? undefined },
          update: {
            pkPosition: c.pkPosition,
            dataTypeNative: c.dataTypeNative,
            dataTypeCanonical: c.dataTypeCanonical,
            isNullable: c.isNullable,
            isPrimaryKey: c.isPrimaryKey,
          },
        })
      )
    );
    return this.db.dataSourceColumn.findMany({
      where: { tableId },
      orderBy: { columnName: 'asc' },
    });
  }

  async bulkUpdateEdaResults(
    updates: Array<{ id: string; summary: string; cardinality: 'categorical' | 'high_card' | null }>
  ): Promise<void> {
    if (updates.length === 0) return;
    await this.db.$transaction(
      updates.map((u) =>
        this.db.dataSourceColumn.update({
          where: { id: u.id },
          data: { summary: u.summary, cardinality: u.cardinality },
        })
      )
    );
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

  async update(id: string, data: UpdateDataSourceColumnInput): Promise<DataSourceColumn> {
    return this.db.dataSourceColumn.update({ where: { id }, data });
  }

  async delete(id: string): Promise<DataSourceColumn> {
    return this.db.dataSourceColumn.delete({ where: { id } });
  }
}
