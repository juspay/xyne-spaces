import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ConversationParticipantsACL extends BaseQueryACL<Prisma.ConversationParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationParticipantWhereInput> {
    return {
      OR: [
        {
          channel: {
            workspaceId: this.ctx.workspaceId ?? '',
            participants: { some: { userId: this.ctx.userId } },
          },
        },
        {
          conversation: {
            channel: {
              workspaceId: this.ctx.workspaceId ?? '',
              participants: { some: { userId: this.ctx.userId } },
            },
          },
        },
      ],
    }
  }
}
