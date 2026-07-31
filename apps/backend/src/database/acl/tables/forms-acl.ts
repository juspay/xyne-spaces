import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasResourceAdminAccess } from '../admin-access'
import { denyGuestWhere, isGuestContext } from './channel-access-helper'

export class FormsACL extends BaseQueryACL<
  Prisma.FormWhereInput,
  Prisma.FormUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.FormWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      return denyGuestWhere('id')
    }

    // Direct workspaceId check - no user lookup needed
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.FormWhereInput> {
    if (await hasResourceAdminAccess(this.prisma, this.ctx.userId, 'FORMS')) {
      return { workspaceId: this.ctx.workspaceId }
    }
    return { workspaceId: this.ctx.workspaceId, createdBy: this.ctx.userId }
  }

  async canCreate(data: Prisma.FormUncheckedCreateInput): Promise<boolean> {
    return data.createdBy === this.ctx.userId && data.workspaceId === this.ctx.workspaceId
  }
}
