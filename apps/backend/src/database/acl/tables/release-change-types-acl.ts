import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReleaseChangeTypesACL extends BaseQueryACL<
  Prisma.ReleaseChangeTypeWhereInput,
  Prisma.ReleaseChangeTypeUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReleaseChangeTypeWhereInput> {
    // Scope via application → board.workspaceId.
    const boards = await this.prisma.board.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    const applications = await this.prisma.application.findMany({
      where: { boardId: { in: boards.map((b) => b.id) } },
      select: { id: true },
    })
    return { applicationId: { in: applications.map((a) => a.id) } }
  }

  async getMutateWhere(): Promise<Prisma.ReleaseChangeTypeWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ReleaseChangeTypeUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
