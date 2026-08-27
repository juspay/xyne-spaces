import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getAccessibleChannelIds,
  getConnectAccessibleChannelIds,
  isGuestContext,
} from './channel-access-helper'

export class ChannelStatsACL extends BaseQueryACL<
  Prisma.ChannelStatsWhereInput,
  Prisma.ChannelStatsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelStatsWhereInput> {
    const ctx = this.ctx
    // Slack-Connect: stats for connect channels the caller is an active member of.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    const connectClause: Prisma.ChannelStatsWhereInput[] = connectChannelIds.length
      ? [{ channelId: { in: connectChannelIds } }]
      : []

    if (isGuestContext(ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        OR: [
          {
            channel: {
              workspaceId: this.ctx.workspaceId ?? '',
              id: { in: channelIds },
            },
          },
          ...connectClause,
        ],
      }
    }

    return {
      OR: [
        {
          workspaceId: this.ctx.workspaceId,
          channel: {
            OR: [
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
            ],
          },
        },
        ...connectClause,
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelStatsWhereInput> {
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    if (connectChannelIds.length === 0) {
      return { workspaceId: this.ctx.workspaceId }
    }
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { channelId: { in: connectChannelIds } },
      ],
    }
  }

  async canCreate(_data: Prisma.ChannelStatsUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
