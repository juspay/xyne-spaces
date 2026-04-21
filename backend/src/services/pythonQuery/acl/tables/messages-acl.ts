import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MessagesACL extends BaseQueryACL<Prisma.MessageWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageWhereInput> {
    return {
      AND: [
        {
          OR: [{ visibleTo: null }, { visibleTo: this.ctx.userId }],
        },
        {
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
      ],
    }
  }
}
