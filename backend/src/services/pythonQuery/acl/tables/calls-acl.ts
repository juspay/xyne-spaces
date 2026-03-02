import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CallsACL extends BaseQueryACL<Prisma.CallWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallWhereInput> {
    return {
      OR: [
        { createdByUserId: this.ctx.userId },
        { participants: { some: { userId: this.ctx.userId } } },
        { channel: { participants: { some: { userId: this.ctx.userId } } } },
      ],
    }
  }
}
