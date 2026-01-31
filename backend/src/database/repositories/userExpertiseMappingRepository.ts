import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class UserExpertiseMappingRepository extends BaseRepository<
  Prisma.UserExpertiseMappingGetPayload<{}>,
  Prisma.UserExpertiseMappingCreateInput,
  Prisma.UserExpertiseMappingUpdateInput
> {
  constructor() {
    super('userExpertiseMapping');
  }

  async create(data: Prisma.UserExpertiseMappingCreateInput) {
    return this.db.userExpertiseMapping.create({ data });
  }

  async findById(id: string) {
    return this.db.userExpertiseMapping.findUnique({ where: { id } });
  }

  async findMany(options?: { where?: Prisma.UserExpertiseMappingWhereInput; skip?: number; take?: number; orderBy?: Prisma.UserExpertiseMappingOrderByWithRelationInput }) {
    return this.db.userExpertiseMapping.findMany(options || {});
  }

  async update(id: string, data: Prisma.UserExpertiseMappingUpdateInput) {
    return this.db.userExpertiseMapping.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.db.userExpertiseMapping.delete({ where: { id } });
  }
}
