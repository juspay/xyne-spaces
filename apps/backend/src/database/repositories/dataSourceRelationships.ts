import { BaseRepository } from './base';
import type {
  DataSourceRelationship,
  CreateDataSourceRelationshipInput,
  UpdateDataSourceRelationshipInput,
  QueryOptions,
} from '@/types/database';

export class DataSourceRelationshipRepository extends BaseRepository<
  DataSourceRelationship,
  CreateDataSourceRelationshipInput,
  UpdateDataSourceRelationshipInput
> {
  constructor() {
    super('dataSourceRelationship');
  }

  async create(
    data: CreateDataSourceRelationshipInput,
  ): Promise<DataSourceRelationship> {
    return this.db.dataSourceRelationship.create({ data });
  }

  async bulkCreate(
    rows: CreateDataSourceRelationshipInput[],
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await this.db.dataSourceRelationship.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  async replaceForDataSource(
    dataSourceId: string,
    rows: CreateDataSourceRelationshipInput[],
  ): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await tx.dataSourceRelationship.deleteMany({ where: { dataSourceId } });
      if (rows.length === 0) return 0;
      const result = await tx.dataSourceRelationship.createMany({
        data: rows,
        skipDuplicates: true,
      });
      return result.count;
    });
  }

  async findById(id: string): Promise<DataSourceRelationship | null> {
    return this.db.dataSourceRelationship.findUnique({ where: { id } });
  }

  async findByDataSource(dataSourceId: string): Promise<DataSourceRelationship[]> {
    return this.db.dataSourceRelationship.findMany({
      where: { dataSourceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findMany(options?: QueryOptions): Promise<DataSourceRelationship[]> {
    const { skip, take, orderBy, where } = options ?? {};
    return this.db.dataSourceRelationship.findMany({ skip, take, orderBy, where });
  }

  async deleteByDataSource(dataSourceId: string): Promise<number> {
    const result = await this.db.dataSourceRelationship.deleteMany({
      where: { dataSourceId },
    });
    return result.count;
  }

  async update(
    id: string,
    data: UpdateDataSourceRelationshipInput,
  ): Promise<DataSourceRelationship> {
    return this.db.dataSourceRelationship.update({ where: { id }, data });
  }

  async delete(id: string): Promise<DataSourceRelationship> {
    return this.db.dataSourceRelationship.delete({ where: { id } });
  }
}
