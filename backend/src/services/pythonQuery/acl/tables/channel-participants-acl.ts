import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelParticipantsACL extends BaseQueryACL<Prisma.ChannelParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelParticipantWhereInput> {
    // Get channel IDs where user is a participant
    const participantChannels = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    })

    const participantChannelIds = participantChannels.map((p) => p.channelId)

    // Get public channel IDs
    const publicChannels = await this.prisma.channel.findMany({
      where: { visibility: 'PUBLIC' },
      select: { id: true },
    })

    const publicChannelIds = publicChannels.map((c) => c.id)

    // Combine accessible channel IDs
    const accessibleChannelIds = [...new Set([...participantChannelIds, ...publicChannelIds])]

    return {
      channelId: { in: accessibleChannelIds },
    }
  }
}
