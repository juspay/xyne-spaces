import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'

export class BoardComplexityScoresACL extends BaseQueryACL<
  Prisma.BoardComplexityScoreWhereInput,
  Prisma.BoardComplexityScoreUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardComplexityScoreWhereInput> {
    return {
      board: {
        workspaceId: this.ctx.workspaceId,
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.BoardComplexityScoreWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')) {
      return { workspaceId }
    }
    const mappings = await this.prisma.userGroupMapping.findMany({
      where: { userId: this.ctx.userId },
      select: { userGroupId: true },
    })
    return { workspaceId, userGroupId: { in: mappings.map((m) => m.userGroupId) } }
  }

  async canCreate(data: Prisma.BoardComplexityScoreUncheckedCreateInput): Promise<boolean> {
    const userGroup = await this.prisma.userGroup.findFirst({
      where: { id: data.userGroupId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    if (!userGroup) return false
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')) return true
    const membership = await this.prisma.userGroupMapping.findFirst({
      where: { userGroupId: data.userGroupId, userId: this.ctx.userId },
      select: { id: true },
    })
    return membership !== null
  }
}
