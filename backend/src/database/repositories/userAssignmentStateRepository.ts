import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class UserAssignmentStateRepository extends BaseRepository<
  Prisma.UserAssignmentStateGetPayload<{}>,
  Prisma.UserAssignmentStateCreateInput,
  Prisma.UserAssignmentStateUpdateInput
> {
  constructor() {
    super('userAssignmentState');
  }

  async create(data: Prisma.UserAssignmentStateCreateInput) {
    return this.db.userAssignmentState.create({ data });
  }

  async findById(id: string) {
    return this.db.userAssignmentState.findUnique({ where: { id } });
  }

  async findMany(options?: { where?: Prisma.UserAssignmentStateWhereInput; skip?: number; take?: number; orderBy?: Prisma.UserAssignmentStateOrderByWithRelationInput }) {
    return this.db.userAssignmentState.findMany(options || {});
  }

  async findUnique(args: Prisma.UserAssignmentStateFindUniqueArgs) {
    return this.db.userAssignmentState.findUnique(args);
  }

  async update(id: string, data: Prisma.UserAssignmentStateUpdateInput) {
    return this.db.userAssignmentState.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.db.userAssignmentState.delete({ where: { id } });
  }
}
