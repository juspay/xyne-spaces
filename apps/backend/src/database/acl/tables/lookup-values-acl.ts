import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class LookupValuesACL extends BaseQueryACL<
  Prisma.LookupValueWhereInput,
  Prisma.LookupValueUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — form-field dropdown reference data.
  async getWhereClause(): Promise<Prisma.LookupValueWhereInput | null> {
    return null
  }

  async getMutateWhere(): Promise<Prisma.LookupValueWhereInput> {
    return {}
  }

  async canCreate(_data: Prisma.LookupValueUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
