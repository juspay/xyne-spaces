import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class LookupValuesACL extends BaseQueryACL<Prisma.LookupValueWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — form-field dropdown reference data.
  async getWhereClause(): Promise<Prisma.LookupValueWhereInput | null> {
    return null
  }
}
