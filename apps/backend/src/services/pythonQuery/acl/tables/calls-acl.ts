import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class CallsACL extends BaseQueryACL<Prisma.CallWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        channel: {
          workspaceId: this.ctx.workspaceId ?? '',
          id: { in: channelIds },
        },
      }
    }

    return {
      AND: [
        {
          OR: [
            { createdByUserId: this.ctx.userId },
            { participants: { some: { userId: this.ctx.userId } } },
            { channel: { participants: { some: { userId: this.ctx.userId } } } },
          ],
        },
        { channel: { workspaceId: this.ctx.workspaceId ?? '' } },
      ],
    }
  }
}
