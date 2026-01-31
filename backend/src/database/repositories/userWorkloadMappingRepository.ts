import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class UserWorkloadMappingRepository extends BaseRepository<
  Prisma.UserWorkloadMappingGetPayload<{}>,
  Prisma.UserWorkloadMappingCreateInput,
  Prisma.UserWorkloadMappingUpdateInput
> {
  constructor() {
    super('userWorkloadMapping');
  }

  async create(data: Prisma.UserWorkloadMappingCreateInput) {
    return this.db.userWorkloadMapping.create({ data });
  }

  async findById(id: string) {
    return this.db.userWorkloadMapping.findUnique({ where: { id } });
  }

  async findMany(options?: { where?: Prisma.UserWorkloadMappingWhereInput; skip?: number; take?: number; orderBy?: Prisma.UserWorkloadMappingOrderByWithRelationInput }) {
    return this.db.userWorkloadMapping.findMany(options || {});
  }

  async update(id: string, data: Prisma.UserWorkloadMappingUpdateInput) {
    return this.db.userWorkloadMapping.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.db.userWorkloadMapping.delete({ where: { id } });
  }

  async upsert(args: Prisma.UserWorkloadMappingUpsertArgs) {
    return this.db.userWorkloadMapping.upsert(args);
  }
}
