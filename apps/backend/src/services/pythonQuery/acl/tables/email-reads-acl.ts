import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class EmailReadsACL extends BaseQueryACL<Prisma.EmailReadWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.EmailReadWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
