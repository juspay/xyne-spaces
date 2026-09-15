import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ChannelStatsACL extends BaseQueryACL<
  Prisma.ChannelStatsWhereInput,
  Prisma.ChannelStatsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelStatsWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        channel: {
          workspaceId: this.ctx.workspaceId ?? '',
          id: { in: channelIds },
        },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
      channel: {
        OR: [
          { visibility: 'PUBLIC' },
          { participants: { some: { userId: this.ctx.userId } } },
        ],
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelStatsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(_data: Prisma.ChannelStatsUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
