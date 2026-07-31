import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelParticipantsACL extends BaseQueryACL<
  Prisma.ChannelParticipantWhereInput,
  Prisma.ChannelParticipantUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelParticipantWhereInput> {
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
        { channel: { workspaceId: this.ctx.workspaceId } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelParticipantWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { userId: this.ctx.userId },
        { channel: { participants: { some: { userId: this.ctx.userId, role: 'ADMIN' } } } },
      ],
    }
  }

  async canCreate(data: Prisma.ChannelParticipantUncheckedCreateInput): Promise<boolean> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, workspaceId: this.ctx.workspaceId },
      select: { isArchived: true, scopeType: true, visibility: true },
    })
    if (!channel) return false
    if (channel.isArchived) return false
    if (channel.scopeType === 'DM') {
      const existingCount = await this.prisma.channelParticipant.count({
        where: { channelId: data.channelId },
      })
      if (existingCount >= 2) return false
    }
    if (channel.visibility === 'PUBLIC') return true
    const existing = await this.prisma.channelParticipant.findFirst({
      where: { channelId: data.channelId, userId: this.ctx.userId },
      select: { id: true },
    })
    return existing !== null
  }
}
