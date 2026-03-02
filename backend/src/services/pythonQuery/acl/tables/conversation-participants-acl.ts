import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ConversationParticipantsACL extends BaseQueryACL<Prisma.ConversationParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationParticipantWhereInput | null> {
    return {
      conversation: {
        channel: {
          OR: [
            { visibility: 'PUBLIC' },
            { participants: { some: { userId: this.ctx.userId } } },
          ],
        },
      },
    }
  }
}
