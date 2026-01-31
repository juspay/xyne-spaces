import { BaseRepository } from './base';
import { Prisma } from '@prisma/client';

export class BoardComplexityScoreRepository extends BaseRepository<
  Prisma.BoardComplexityScoreGetPayload<{}>,
  Prisma.BoardComplexityScoreCreateInput,
  Prisma.BoardComplexityScoreUpdateInput
> {
  constructor() {
    super('boardComplexityScore');
  }

  async create(data: Prisma.BoardComplexityScoreCreateInput) {
    return this.db.boardComplexityScore.create({ data });
  }

  async findById(id: string) {
    return this.db.boardComplexityScore.findUnique({ where: { id } });
  }

  async findMany(options?: { where?: Prisma.BoardComplexityScoreWhereInput; skip?: number; take?: number; orderBy?: Prisma.BoardComplexityScoreOrderByWithRelationInput }) {
    return this.db.boardComplexityScore.findMany(options || {});
  }

  async findUnique(args: Prisma.BoardComplexityScoreFindUniqueArgs) {
    return this.db.boardComplexityScore.findUnique(args);
  }

  async update(id: string, data: Prisma.BoardComplexityScoreUpdateInput) {
    return this.db.boardComplexityScore.update({ where: { id }, data });
  }

  async delete(id: string) {
    return this.db.boardComplexityScore.delete({ where: { id } });
  }
}
