import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelSectionsACL extends BaseQueryACL<
  Prisma.ChannelSectionWhereInput,
  Prisma.ChannelSectionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelSectionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelSectionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
