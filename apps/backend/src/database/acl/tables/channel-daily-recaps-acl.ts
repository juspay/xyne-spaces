import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelDailyRecapsACL extends BaseQueryACL<
  Prisma.ChannelDailyRecapWhereInput,
  Prisma.ChannelDailyRecapUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelDailyRecapWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelDailyRecapWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
