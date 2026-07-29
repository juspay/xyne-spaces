import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class CallParticipantsACL extends BaseQueryACL<Prisma.CallParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallParticipantWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        call: {
          channel: {
            workspaceId: this.ctx.workspaceId ?? '',
            id: { in: channelIds },
          },
        },
      }
    }

    return {
      AND: [
        {
          call: {
            OR: [
              { createdByUserId: this.ctx.userId },
              { participants: { some: { userId: this.ctx.userId } } },
              {
                channel: {
                  visibility: 'PUBLIC',
                  participants: { some: { userId: this.ctx.userId } },
                },
              },
            ],
          },
        },
        { call: { channel: { workspaceId: this.ctx.workspaceId ?? '' } } },
      ],
    }
  }
}
