import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserPresenceACL extends BaseQueryACL<
  Prisma.UserPresenceWhereInput,
  Prisma.UserPresenceUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserPresenceWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.UserPresenceWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async canCreate(_data: Prisma.UserPresenceUncheckedCreateInput): Promise<boolean> {
    // Presence rows are created only by trusted backend flows (auth/presence API), which can
    // run under a live request context. Direct client inserts are already blocked by Zero's
    // canInsert, so the Prisma layer allows the create rather than breaking those flows.
    return true
  }
}
