import { Prisma, PrismaClient } from '@prisma/client'
import { ACLContext, BaseQueryACL } from '../base-acl'

export class ChannelBoardMappingsACL extends BaseQueryACL<
  Prisma.ChannelBoardMappingWhereInput,
  Prisma.ChannelBoardMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelBoardMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.ChannelBoardMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ChannelBoardMappingUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
