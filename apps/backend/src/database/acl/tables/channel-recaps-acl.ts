import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelRecapsACL extends BaseQueryACL<
  Prisma.ChannelRecapWhereInput,
  Prisma.ChannelRecapUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelRecapWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelRecapWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
