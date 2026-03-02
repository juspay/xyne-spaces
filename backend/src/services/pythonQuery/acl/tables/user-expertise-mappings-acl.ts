import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserExpertiseMappingsACL extends BaseQueryACL<Prisma.UserExpertiseMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserExpertiseMappingWhereInput | null> {
    return null
  }
}
