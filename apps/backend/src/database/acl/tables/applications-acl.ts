import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ApplicationsACL extends BaseQueryACL<
  Prisma.ApplicationWhereInput,
  Prisma.ApplicationUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ApplicationWhereInput> {
    // Scope via board.workspaceId (Board has direct workspaceId).
    const boards = await this.prisma.board.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { boardId: { in: boards.map((b) => b.id) } }
  }

  async getMutateWhere(): Promise<Prisma.ApplicationWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ApplicationUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
