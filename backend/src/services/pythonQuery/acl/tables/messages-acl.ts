import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class MessagesACL extends BaseQueryACL<Prisma.MessageWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        AND: [
          {
            OR: [{ visibleTo: null }, { visibleTo: this.ctx.userId }],
          },
          {
            conversation: {
              channel: {
                workspaceId: this.ctx.workspaceId ?? '',
                id: { in: channelIds },
              },
            },
          },
        ],
      }
    }

    return {
      AND: [
        {
          OR: [{ visibleTo: null }, { visibleTo: this.ctx.userId }],
        },
        {
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
      ],
    }
  }
}
