import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class StagePRStatusMappingsACL extends BaseQueryACL<
  Prisma.StagePRStatusMappingWhereInput,
  Prisma.StagePRStatusMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.StagePRStatusMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.StagePRStatusMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
