import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ReactionsACL extends BaseQueryACL<Prisma.ReactionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        message: {
          conversation: {
            channel: {
              workspaceId: this.ctx.workspaceId ?? '',
              id: { in: channelIds },
            },
          },
        },
      }
    }

    return {
      message: {
        conversation: {
          channel: {
            AND: [
              { workspaceId: this.ctx.workspaceId ?? '' },
              {
                OR: [
                  { visibility: 'PUBLIC' },
                  { participants: { some: { userId: this.ctx.userId } } },
                ],
              },
            ],
          },
        },
      },
    }
  }
}
