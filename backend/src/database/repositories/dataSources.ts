import { BaseRepository } from './base';
import type {
  DataSource,
  CreateDataSourceInput,
  UpdateDataSourceInput,
  QueryOptions,
} from '@/types/database';

export class DataSourceRepository extends BaseRepository<
  DataSource,
  CreateDataSourceInput,
  UpdateDataSourceInput
> {
  constructor() {
    super('dataSource');
  }

  async create(data: CreateDataSourceInput): Promise<DataSource> {
    return this.db.dataSource.create({ data });
  }

  async findById(id: string): Promise<DataSource | null> {
    return this.db.dataSource.findUnique({ where: { id } });
  }

  async findByWorkspaceAndName(
    workspaceId: string,
    name: string,
  ): Promise<DataSource | null> {
    return this.db.dataSource.findUnique({
      where: { workspaceId_name: { workspaceId, name } },
    });
  }

  async findMany(options?: QueryOptions): Promise<DataSource[]> {
    const { skip, take, orderBy, where } = options ?? {};
    return this.db.dataSource.findMany({ skip, take, orderBy, where });
  }

  async findByWorkspace(workspaceId: string): Promise<DataSource[]> {
    return this.db.dataSource.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: UpdateDataSourceInput): Promise<DataSource> {
    return this.db.dataSource.update({ where: { id }, data });
  }

  async updateIngestionStatus(
    id: string,
    status: 'pending' | 'in_progress' | 'complete' | 'error',
  ): Promise<DataSource> {
    return this.db.dataSource.update({
      where: { id },
      data: { ingestionStatus: status },
    });
  }

  async tryClaimForIngestion(id: string): Promise<boolean> {
    const res = await this.db.dataSource.updateMany({
      where: { id, ingestionStatus: { in: ['pending', 'error'] } },
      data: { ingestionStatus: 'in_progress' },
    });
    return res.count === 1;
  }

  async delete(id: string): Promise<DataSource> {
    return this.db.dataSource.delete({ where: { id } });
  }
}
