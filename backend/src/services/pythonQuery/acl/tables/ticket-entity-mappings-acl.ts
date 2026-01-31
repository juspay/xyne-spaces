import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds } from './channel-access-helper'

export class TicketEntityMappingsACL extends BaseQueryACL<Prisma.TicketEntityMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketEntityMappingWhereInput | null> {
    const accessibleTicketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId)

    return {
      ticketId: { in: accessibleTicketIds },
    }
  }
}
