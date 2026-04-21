import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ConversationsACL extends BaseQueryACL<Prisma.ConversationWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationWhereInput> {
    return {
      channel: {
        AND: [
          { workspaceId: this.ctx.workspaceId ?? '' },
          {
            OR: [
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
            ],
          },
        ],
      },
    }
  }
}
