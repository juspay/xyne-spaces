import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MerchantsACL extends BaseQueryACL<
  Prisma.MerchantWhereInput,
  Prisma.MerchantUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — merchants list is shared reference data.
  async getWhereClause(): Promise<Prisma.MerchantWhereInput | null> {
    return null
  }

  async getMutateWhere(): Promise<Prisma.MerchantWhereInput> {
    return {}
  }

  async canCreate(_data: Prisma.MerchantUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
