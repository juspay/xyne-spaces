import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleProjectIds, isGuestContext } from './channel-access-helper'

export class StagesACL extends BaseQueryACL<Prisma.StageWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.StageWhereInput> {
    if (isGuestContext(this.ctx)) {
      const projectIds = await getGuestAccessibleProjectIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        board: {
          workspaceId: this.ctx.workspaceId ?? '',
          projectId: { in: projectIds },
        },
      }
    }

    // Direct workspaceId check through board - no need to traverse through project
    return {
      board: {
        workspaceId: this.ctx.workspaceId,
        project: {
          channels: {
            some: {
              OR: [
                { visibility: 'PUBLIC' },
                { participants: { some: { userId: this.ctx.userId } } },
              ],
            },
          },
        },
      },
    }
  }
}
