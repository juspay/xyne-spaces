import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ClassificationMappingsACL extends BaseQueryACL<
  Prisma.ClassificationMappingWhereInput,
  Prisma.ClassificationMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // No table-specific read rule; the extension applies the workspace default.
  async getWhereClause(): Promise<Prisma.ClassificationMappingWhereInput | null> {
    return null
  }

  async getMutateWhere(): Promise<Prisma.ClassificationMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ClassificationMappingUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
