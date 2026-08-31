import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class StagesACL extends BaseQueryACL<Prisma.StageWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.StageWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        board: {
          workspaceId: this.ctx.workspaceId ?? '',
          channelMappings: {
            some: {
              channelId: { in: channelIds },
            },
          },
        },
      }
    }

    // Scope to the board's workspace, matching BoardsACL.
    return {
      board: {
        workspaceId: this.ctx.workspaceId,
      },
    }
  }
}
