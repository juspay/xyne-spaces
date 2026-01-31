import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds } from './channel-access-helper'

export class TicketReferenceMappingsACL extends BaseQueryACL<Prisma.TicketReferenceMappingWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketReferenceMappingWhereInput | null> {
    const accessibleTicketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId)

    // Filter by sourceTicketId (user must have access to the source ticket)
    return {
      sourceTicketId: { in: accessibleTicketIds },
    }
  }
}
