import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MessagesACL extends BaseQueryACL<Prisma.MessageWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageWhereInput> {
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

    // Get conversation IDs from accessible channels
    const accessibleConversations = await this.prisma.conversation.findMany({
      where: { channelId: { in: accessibleChannelIds } },
      select: { conversationId: true },
    })

    const accessibleConversationIds = accessibleConversations.map((c) => c.conversationId)

    return {
      AND: [
        // Visibility check
        {
          OR: [
            { visibleTo: null },
            { visibleTo: this.ctx.userId },
          ],
        },
        // Channel access check via conversation
        { conversationId: { in: accessibleConversationIds } },
      ],
    }
  }
}
