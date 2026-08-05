import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class UserGroupMappingsACL extends BaseQueryACL<
  Prisma.UserGroupMappingWhereInput,
  Prisma.UserGroupMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserGroupMappingWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      return denyGuestWhere('id')
    }

    return {
      userGroup: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.UserGroupMappingWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')) {
      return { workspaceId, userGroup: { workspaceId } }
    }
    return {
      workspaceId,
      userGroup: {
        workspaceId,
        createdBy: this.ctx.userId,
        resourceAccess: { none: {} },
      },
    }
  }

  async canCreate(data: Prisma.UserGroupMappingUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const userGroup = await this.prisma.userGroup.findFirst({
      where: { id: data.userGroupId, workspaceId: this.ctx.workspaceId },
      select: { id: true, createdBy: true },
    })
    if (!userGroup) return false
    const targetUser = await this.prisma.user.findFirst({
      where: { id: data.userId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    if (!targetUser) return false
    if (data.roleId) {
      const role = await this.prisma.role.findFirst({
        where: { id: data.roleId, workspaceId: this.ctx.workspaceId },
        select: { id: true },
      })
      if (!role) return false
    }
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')) return true
    if (userGroup.createdBy !== this.ctx.userId) return false
    const grant = await this.prisma.resourceAccess.findFirst({
      where: { groupId: data.userGroupId },
      select: { id: true },
    })
    return grant === null
  }
}
