import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class DelayedMessagesACL extends BaseQueryACL<
  Prisma.DelayedMessageWhereInput,
  Prisma.DelayedMessageUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.DelayedMessageWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.DelayedMessageWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
