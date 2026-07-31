import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class StageApproversACL extends BaseQueryACL<Prisma.StageApproversWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — approver configuration is shared reference data.
  async getWhereClause(): Promise<Prisma.StageApproversWhereInput | null> {
    return null
  }
}
