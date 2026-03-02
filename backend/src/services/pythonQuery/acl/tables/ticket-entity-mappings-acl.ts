import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketEntityMappingsACL extends BaseQueryACL<Prisma.TicketEntityMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketEntityMappingWhereInput | null> {
    return null
  }
}
