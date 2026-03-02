import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketActivitiesACL extends BaseQueryACL<Prisma.TicketActivityWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketActivityWhereInput | null> {
    return null
  }
}
