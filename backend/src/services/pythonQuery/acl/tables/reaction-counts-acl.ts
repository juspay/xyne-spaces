import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReactionCountsACL extends BaseQueryACL<Prisma.ReactionCountWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionCountWhereInput> {
    return {
      message: {
        conversation: {
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
        },
      },
    }
  }
}
