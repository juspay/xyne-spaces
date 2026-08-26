import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getAccessibleChannelIds,
  getConnectAccessibleChannelIds,
  hasGuestChannelAccess,
  isGuestContext,
} from './channel-access-helper'

export class ReactionsACL extends BaseQueryACL<
  Prisma.ReactionWhereInput,
  Prisma.ReactionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionWhereInput> {
    // Slack-Connect: reactions on connect channels the caller is an active member of, across orgs.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    const connectBranch: Prisma.ReactionWhereInput = {
      message: { conversation: { channelId: { in: connectChannelIds } } },
    }

    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        OR: [
          {
            message: {
              conversation: {
                channel: {
                  workspaceId: this.ctx.workspaceId ?? '',
                  id: { in: channelIds },
                },
              },
            },
          },
          connectBranch,
        ],
      }
    }

    return {
      OR: [
        {
          message: {
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
        },
        connectBranch,
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ReactionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { userId: this.ctx.userId },
        { message: { senderId: this.ctx.userId } },
      ],
    }
  }

  async canCreate(data: Prisma.ReactionUncheckedCreateInput): Promise<boolean> {
    const message = await this.prisma.message.findFirst({
      where: { messageId: data.messageId },
      select: {
        conversation: {
          select: {
            channel: {
              select: {
                id: true,
                workspaceId: true,
                visibility: true,
                participants: {
                  where: { userId: this.ctx.userId },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    })
    const channel = message?.conversation?.channel
    if (!channel) return false
    if (channel.workspaceId !== this.ctx.workspaceId) return false
    if (channel.visibility === 'PUBLIC') return true
    if (channel.participants.length > 0) return true
    return hasGuestChannelAccess(this.prisma, this.ctx, channel.id)
  }
}
