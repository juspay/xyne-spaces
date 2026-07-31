import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MerchantsACL extends BaseQueryACL<Prisma.MerchantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — merchants list is shared reference data.
  async getWhereClause(): Promise<Prisma.MerchantWhereInput | null> {
    return null
  }
}
