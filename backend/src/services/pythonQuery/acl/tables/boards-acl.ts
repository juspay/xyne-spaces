import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleProjectIds, isGuestContext } from './channel-access-helper'

export class BoardsACL extends BaseQueryACL<Prisma.BoardWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardWhereInput> {
    if (isGuestContext(this.ctx)) {
      const projectIds = await getGuestAccessibleProjectIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        projectId: { in: projectIds },
      }
    }

    // Direct workspaceId check - no need to traverse through project
    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
