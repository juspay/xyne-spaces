import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ChannelParticipantsACL extends BaseQueryACL<Prisma.ChannelParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelParticipantWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        AND: [
          {
            OR: [
              { userId: this.ctx.userId },
              { channelId: { in: channelIds } },
            ],
          },
          { channel: { workspaceId: this.ctx.workspaceId ?? '' } },
        ],
      }
    }

    return {
      AND: [
        {
          OR: [
            { userId: this.ctx.userId },
            {
              channel: {
                OR: [
                  { visibility: 'PUBLIC' },
                  { participants: { some: { userId: this.ctx.userId } } },
                ],
              },
            },
          ],
        },
        { channel: { workspaceId: this.ctx.workspaceId ?? '' } },
      ],
    }
  }
}
