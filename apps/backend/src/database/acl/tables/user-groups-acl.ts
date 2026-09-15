import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class UserGroupsACL extends BaseQueryACL<
  Prisma.UserGroupWhereInput,
  Prisma.UserGroupUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserGroupWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      return denyGuestWhere('id')
    }

    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.UserGroupWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')) {
      return { workspaceId }
    }
    return { workspaceId, createdBy: this.ctx.userId }
  }

  async canCreate(data: Prisma.UserGroupUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    return hasResourceAdminAccess(this.prisma, this.ctx.userId, 'USER-GROUPS')
  }
}
