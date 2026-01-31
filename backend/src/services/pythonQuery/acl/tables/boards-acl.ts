import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class BoardsACL extends BaseQueryACL<Prisma.BoardWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardWhereInput> {
    // Get channel IDs where user is a participant
    const participantChannels = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    })

    const participantChannelIds = participantChannels.map((p) => p.channelId)

    // Get project IDs from channels user participates in or public channels
    const channelsWithProjects = await this.prisma.channel.findMany({
      where: {
        OR: [
          { id: { in: participantChannelIds } },
          { visibility: 'PUBLIC' },
        ],
      },
      select: { projectId: true },
    })

    const accessibleProjectIds = [...new Set(channelsWithProjects.map((c) => c.projectId))]

    return {
      OR: [
        { createdBy: this.ctx.userId },
        { projectId: { in: accessibleProjectIds } },
      ],
    }
  }
}
