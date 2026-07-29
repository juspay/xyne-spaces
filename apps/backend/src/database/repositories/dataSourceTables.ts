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

  async syncForDataSource(
    dataSourceId: string,
    rows: Array<{ schemaName: string; tableName: string; rowCountEstimate: bigint | null }>
  ): Promise<DataSourceTable[]> {
    const dataSource = await this.db.dataSource.findUnique({
      where: { id: dataSourceId },
      select: { workspaceId: true },
    });
    if (!dataSource) {
      throw new Error(`workspaceId required: dataSource ${dataSourceId} not found`);
    }
    const existing = await this.db.dataSourceTable.findMany({
      where: { dataSourceId },
      select: { id: true, schemaName: true, tableName: true },
    });
    const keep = new Set(rows.map((r) => `${r.schemaName}.${r.tableName}`));
    const staleIds = existing
      .filter((t) => !keep.has(`${t.schemaName}.${t.tableName}`))
      .map((t) => t.id);
    if (staleIds.length > 0) {
      await this.db.dataSourceTable.deleteMany({ where: { id: { in: staleIds } } });
    }
    await this.db.$transaction(
      rows.map((r) =>
        this.db.dataSourceTable.upsert({
          where: {
            dataSourceId_schemaName_tableName: {
              dataSourceId,
              schemaName: r.schemaName,
              tableName: r.tableName,
            },
          },
          create: {
            dataSourceId,
            workspaceId: dataSource.workspaceId,
            schemaName: r.schemaName,
            tableName: r.tableName,
            rowCountEstimate: r.rowCountEstimate ?? undefined,
          },
          update: { rowCountEstimate: r.rowCountEstimate },
        })
      )
    );
    return this.db.dataSourceTable.findMany({
      where: { dataSourceId },
      orderBy: [{ schemaName: 'asc' }, { tableName: 'asc' }],
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

  async update(id: string, data: UpdateDataSourceTableInput): Promise<DataSourceTable> {
    return this.db.dataSourceTable.update({ where: { id }, data });
  }

  async delete(id: string): Promise<DataSourceTable> {
    return this.db.dataSourceTable.delete({ where: { id } });
  }
}
