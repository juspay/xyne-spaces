import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class UserGroupMappingRepository extends BaseRepository<
  Prisma.UserGroupMappingGetPayload<{}>,
  Prisma.UserGroupMappingCreateInput,
  Prisma.UserGroupMappingUpdateInput
> {
  constructor() {
    super('userGroupMapping');
  }

  async create(data: Prisma.UserGroupMappingCreateInput) {
    return this.db.userGroupMapping.create({ data });
  }

  async findById(id: string) {
    return this.db.userGroupMapping.findUnique({ where: { id } });
  }

  async findByUserGroupAndUser(userGroupId: string, userId: string) {
    return this.db.userGroupMapping.findFirst({
      where: {
        userId,
        userGroupId,
      },
    });
  }

  async exists(userGroupId: string, userId: string): Promise<boolean> {
    const mapping = await this.findByUserGroupAndUser(userGroupId, userId);
    return mapping !== null;
  }

  async findMany(options?: { where?: Prisma.UserGroupMappingWhereInput; skip?: number; take?: number; orderBy?: Prisma.UserGroupMappingOrderByWithRelationInput }) {
    return this.db.userGroupMapping.findMany(options || {});
  }

  async update(id: string, data: Prisma.UserGroupMappingUpdateInput) {
    return this.db.userGroupMapping.update({ where: { id }, data });
  }

  async setStartOffsetIfNull(id: string, startOffset: number): Promise<boolean> {
    const result = await this.db.userGroupMapping.updateMany({
      where: { id, startOffset: null },
      data: { startOffset },
    });
    return result.count > 0;
  }

  async delete(id: string) {
    return this.db.userGroupMapping.delete({ where: { id } });
  }
}
