import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class StageReleaseStatusMappingsACL extends BaseQueryACL<
  Prisma.StageReleaseStatusMappingWhereInput,
  Prisma.StageReleaseStatusMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.StageReleaseStatusMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.StageReleaseStatusMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
