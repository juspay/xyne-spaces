import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class LinkAccessACL extends BaseQueryACL<Prisma.LinkAccessWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.LinkAccessWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }
}
