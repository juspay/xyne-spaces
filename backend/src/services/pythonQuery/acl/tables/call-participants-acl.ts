import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CallParticipantsACL extends BaseQueryACL<Prisma.CallParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallParticipantWhereInput | null> {
    const createdCalls = await this.prisma.call.findMany({
      where: { createdByUserId: this.ctx.userId },
      select: { id: true },
    })

    const participantCalls = await this.prisma.callParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { callId: true },
    })

    // Get channels where user participates
    const participantChannels = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    })
    const participantChannelIds = participantChannels.map((p) => p.channelId)

    // Get calls in those channels (no visibility check)
    const channelCalls = await this.prisma.call.findMany({
      where: {
        channelId: { in: participantChannelIds },
      },
      select: { id: true },
    })

    const accessibleCallIds = [
      ...new Set([
        ...createdCalls.map((c) => c.id),
        ...participantCalls.map((p) => p.callId),
        ...channelCalls.map((c) => c.id),
      ]),
    ]

    return {
      callId: { in: accessibleCallIds },
    }
  }
}
