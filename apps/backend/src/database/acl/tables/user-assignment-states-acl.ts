import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'

export class UserAssignmentStatesACL extends BaseQueryACL<
  Prisma.UserAssignmentStateWhereInput,
  Prisma.UserAssignmentStateUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserAssignmentStateWhereInput> {
    return {
      userGroup: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.UserAssignmentStateWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')) {
      return { workspaceId, userGroup: { workspaceId } }
    }
    return {
      workspaceId,
      userGroup: {
        workspaceId,
        userGroupMappings: { some: { userId: this.ctx.userId } },
      },
    }
  }

  async canCreate(data: Prisma.UserAssignmentStateUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
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
