import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketReferenceMappingsACL extends BaseQueryACL<Prisma.TicketReferenceMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketReferenceMappingWhereInput | null> {
    return null
  }
}
