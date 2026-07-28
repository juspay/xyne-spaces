import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ChannelsACL extends BaseQueryACL<Prisma.ChannelWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: channelIds },
      }
    }

    return {
      AND: [
        {
          OR: [
            { visibility: 'PUBLIC' },
            { participants: { some: { userId: this.ctx.userId } } },
          ],
        },
        { workspaceId: this.ctx.workspaceId ?? '' },
      ],
    }
  }
}
