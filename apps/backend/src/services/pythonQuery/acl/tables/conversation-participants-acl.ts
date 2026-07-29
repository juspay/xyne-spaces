import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ConversationParticipantsACL extends BaseQueryACL<Prisma.ConversationParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationParticipantWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        conversation: {
          channel: {
            workspaceId: this.ctx.workspaceId ?? '',
            id: { in: channelIds },
          },
        },
      }
    }

    return {
      OR: [
        {
          channel: {
            workspaceId: this.ctx.workspaceId ?? '',
            participants: { some: { userId: this.ctx.userId } },
          },
        },
        {
          conversation: {
            channel: {
              workspaceId: this.ctx.workspaceId ?? '',
              participants: { some: { userId: this.ctx.userId } },
            },
          },
        },
      ],
    }
  }
}
