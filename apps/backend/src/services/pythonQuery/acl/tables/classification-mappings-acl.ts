import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ClassificationMappingsACL extends BaseQueryACL<Prisma.ClassificationMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — reference data shared across all workspaces.
  async getWhereClause(): Promise<Prisma.ClassificationMappingWhereInput | null> {
    return null
  }
}
