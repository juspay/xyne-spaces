import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CallsACL extends BaseQueryACL<Prisma.CallWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallWhereInput> {
    const participantCalls = await this.prisma.callParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { callId: true },
    })

    const participantCallIds = participantCalls.map((p) => p.callId)

    return {
      OR: [
        { createdByUserId: this.ctx.userId },
        { id: { in: participantCallIds } },
      ],
    }
  }
}
