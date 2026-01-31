import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelsACL extends BaseQueryACL<Prisma.ChannelWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelWhereInput> {
    // Get channel IDs where user is a participant
    const participantChannels = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    })

    const participantChannelIds = participantChannels.map((p) => p.channelId)

    return {
      OR: [
        { visibility: 'PUBLIC' },
        { id: { in: participantChannelIds } },
      ],
    }
  }
}
