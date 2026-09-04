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
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, workspaceId: this.ctx.workspaceId },
      select: { id: true, scopeType: true },
    })
    if (!channel) return false
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: data.channelId, userId: this.ctx.userId },
      select: { role: true },
    })
    if (!participant) return false

    // addUserPolicy only governs adding *other* users to a regular channel.
    // Adding yourself and group DM membership are out of its scope.
    if (data.userId === this.ctx.userId || channel.scopeType === 'GROUP_DM') return true

    const channelStats = await this.prisma.channelStats.findUnique({
      where: { channelId: data.channelId },
      select: { addUserPolicy: true },
    })
    if ((channelStats?.addUserPolicy ?? 'EVERYONE') === 'ADMINS_ONLY' && participant.role !== 'ADMIN') {
      return false
    }
    return true
  }
}
