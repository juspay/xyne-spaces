import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserActivityEventsAcl extends BaseQueryACL<Prisma.UserActivityEventWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserActivityEventWhereInput | null> {
    return {
      userId: this.ctx.userId,
    }
  }

  /** Same scope as reads. */
  async getMutateWhere(): Promise<Prisma.UserActivityEventWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId }
  }
}
