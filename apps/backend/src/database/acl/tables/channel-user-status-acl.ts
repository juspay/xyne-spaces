import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelUserStatusACL extends BaseQueryACL<
  Prisma.ChannelUserStatusWhereInput,
  Prisma.ChannelUserStatusUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelUserStatusWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelUserStatusWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { userId: this.ctx.userId },
        { channel: { participants: { some: { userId: this.ctx.userId, role: 'ADMIN' } } } },
      ],
    }
  }

  async canCreate(data: Prisma.ChannelUserStatusUncheckedCreateInput): Promise<boolean> {
    // channel_stats holds the policy the channel settings edit; channels.addUserPolicy is never updated after create.
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, workspaceId: this.ctx.workspaceId },
      select: { channelStats: { select: { addUserPolicy: true } } },
    })
    if (!channel) return false
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: data.channelId, userId: this.ctx.userId },
      select: { role: true },
    })
    if (!participant) return false
    if (
      data.userId !== this.ctx.userId &&
      participant.role !== 'ADMIN' &&
      (channel.channelStats?.addUserPolicy ?? 'EVERYONE') === 'ADMINS_ONLY'
    ) {
      return false
    }
    return true
  }
}
