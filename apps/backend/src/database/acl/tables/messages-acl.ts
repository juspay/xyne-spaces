import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getAccessibleChannelIds,
  getConnectAccessibleChannelIds,
  hasGuestChannelAccess,
  isGuestContext,
} from './channel-access-helper'

export class MessagesACL extends BaseQueryACL<
  Prisma.MessageWhereInput,
  Prisma.MessageUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageWhereInput> {
    // Slack-Connect: connect channels the caller is an active member of, across orgs.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    const connectBranch: Prisma.MessageWhereInput = {
      conversation: { channelId: { in: connectChannelIds } },
    }

    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        AND: [
          {
            OR: [{ visibleTo: null }, { visibleTo: this.ctx.userId }],
          },
          {
            OR: [
              {
                conversation: {
                  channel: {
                    workspaceId: this.ctx.workspaceId ?? '',
                    id: { in: channelIds },
                  },
                },
              },
              connectBranch,
            ],
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
          OR: [
            {
              conversation: {
                channel: {
                  AND: [
                    { workspaceId: this.ctx.workspaceId },
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
            connectBranch,
          ],
        },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.MessageWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ senderId: this.ctx.userId }, { msgType: 'SYSTEM' }],
    }
  }

  async canCreate(data: Prisma.MessageUncheckedCreateInput): Promise<boolean> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { conversationId: data.conversationId },
      select: {
        channel: {
          select: { id: true, isArchived: true, visibility: true, workspaceId: true },
        },
      },
    })
    if (!conversation || !conversation.channel) return false
    if (conversation.channel.isArchived) return false
    if (conversation.channel.workspaceId !== this.ctx.workspaceId) return false
    if (conversation.channel.visibility === 'PUBLIC') return true
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: conversation.channel.id, userId: this.ctx.userId },
      select: { id: true },
    })
    if (participant !== null) return true
    return hasGuestChannelAccess(this.prisma, this.ctx, conversation.channel.id)
  }
}
