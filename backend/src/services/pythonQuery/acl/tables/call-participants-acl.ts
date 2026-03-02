import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CallParticipantsACL extends BaseQueryACL<Prisma.CallParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallParticipantWhereInput | null> {
    return {
      call: {
        OR: [
          { createdByUserId: this.ctx.userId },
          { participants: { some: { userId: this.ctx.userId } } },
          {
            channel: {
              visibility: 'PUBLIC',
              participants: { some: { userId: this.ctx.userId } },
            },
          },
        ],
      },
    }
  }
}
