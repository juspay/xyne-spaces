import { BaseRepository } from './base';
import type {
  DataSourceTable,
  CreateDataSourceTableInput,
  UpdateDataSourceTableInput,
  QueryOptions,
} from '@/types/database';

export class DataSourceTableRepository extends BaseRepository<
  DataSourceTable,
  CreateDataSourceTableInput,
  UpdateDataSourceTableInput
> {
  constructor() {
    super('dataSourceTable');
  }

  async create(data: CreateDataSourceTableInput): Promise<DataSourceTable> {
    return this.db.dataSourceTable.create({ data });
  }

  async bulkCreateAndReturn(
    rows: CreateDataSourceTableInput[],
  ): Promise<DataSourceTable[]> {
    if (rows.length === 0) return [];
    const dataSourceId = rows[0]!.dataSourceId;
    for (const r of rows) {
      if (r.dataSourceId !== dataSourceId) {
        throw new Error(
          'bulkCreateAndReturn: all rows must share the same dataSourceId',
        );
      }
    }
    return this.db.$transaction(async (tx) => {
      await tx.dataSourceTable.deleteMany({ where: { dataSourceId } });
      await tx.dataSourceTable.createMany({ data: rows });
      return tx.dataSourceTable.findMany({
        where: { dataSourceId },
        orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
      });
    });
  }

  async findById(id: string): Promise<DataSourceTable | null> {
    return this.db.dataSourceTable.findUnique({ where: { id } });
  }

  async findByDataSource(dataSourceId: string): Promise<DataSourceTable[]> {
    return this.db.dataSourceTable.findMany({
      where: { dataSourceId },
      orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
    });
  }

  async findMany(options?: QueryOptions): Promise<DataSourceTable[]> {
    const { skip, take, orderBy, where } = options ?? {};
    return this.db.dataSourceTable.findMany({ skip, take, orderBy, where });
  }

  async update(
    id: string,
    data: UpdateDataSourceTableInput,
  ): Promise<DataSourceTable> {
    return this.db.dataSourceTable.update({ where: { id }, data });
  }

  async delete(id: string): Promise<DataSourceTable> {
    return this.db.dataSourceTable.delete({ where: { id } });
  }
}
