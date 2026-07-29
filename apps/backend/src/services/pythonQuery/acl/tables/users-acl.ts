import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestVisibleUserIds, isGuestContext } from './channel-access-helper'

export class UsersACL extends BaseQueryACL<Prisma.UserWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserWhereInput> {
    if (isGuestContext(this.ctx)) {
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
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
