import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleProjectIds, isGuestContext } from './channel-access-helper'

export class ProjectsACL extends BaseQueryACL<Prisma.ProjectWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ProjectWhereInput> {
    if (isGuestContext(this.ctx)) {
      const projectIds = await getGuestAccessibleProjectIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: projectIds },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
