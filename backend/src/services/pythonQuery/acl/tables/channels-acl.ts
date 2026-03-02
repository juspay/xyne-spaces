import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelsACL extends BaseQueryACL<Prisma.ChannelWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelWhereInput> {
    return {
      OR: [
        { visibility: 'PUBLIC' },
        { participants: { some: { userId: this.ctx.userId } } },
      ],
    }
  }
}
