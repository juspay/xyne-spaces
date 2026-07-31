import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelUserStatusACL extends BaseQueryACL<Prisma.ChannelUserStatusWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelUserStatusWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
