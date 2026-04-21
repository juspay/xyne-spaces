import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReactionsACL extends BaseQueryACL<Prisma.ReactionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionWhereInput> {
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
