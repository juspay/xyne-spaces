import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestVisibleUserIds, isGuestContext } from './channel-access-helper'

export class UsersACL extends BaseQueryACL<
  Prisma.UserWhereInput,
  Prisma.UserUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const userIds = await getGuestVisibleUserIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: userIds },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.UserWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (this.ctx.role === 'ADMIN' || this.ctx.role === 'OWNER') {
      return { workspaceId }
    }
    return { workspaceId, id: this.ctx.userId }
  }

  async canCreate(_data: Prisma.UserUncheckedCreateInput): Promise<boolean> {
    // Users are created only by trusted backend auth flows (which can run under a live
    // request context). Direct client inserts are already blocked by Zero's canInsert, so
    // the Prisma layer allows the create rather than breaking auth.
    return true
  }
}
