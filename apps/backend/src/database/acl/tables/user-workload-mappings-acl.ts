import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserWorkloadMappingsACL extends BaseQueryACL<
  Prisma.UserWorkloadMappingWhereInput,
  Prisma.UserWorkloadMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserWorkloadMappingWhereInput> {
    return {
      userGroup: {
        workspaceId: this.ctx.workspaceId,
        userGroupMappings: { some: { userId: this.ctx.userId } },
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.UserWorkloadMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userGroup: {
        workspaceId: this.ctx.workspaceId,
        userGroupMappings: { some: { userId: this.ctx.userId } },
      },
    }
  }

  async canCreate(data: Prisma.UserWorkloadMappingUncheckedCreateInput): Promise<boolean> {
    const userGroup = await this.prisma.userGroup.findFirst({
      where: { id: data.userGroupId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    if (!userGroup) return false
    const membership = await this.prisma.userGroupMapping.findFirst({
      where: { userGroupId: data.userGroupId, userId: this.ctx.userId },
      select: { id: true },
    })
    return membership !== null
  }
}
