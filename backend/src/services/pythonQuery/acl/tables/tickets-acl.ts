import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class TicketsACL extends BaseQueryACL<Prisma.TicketWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketWhereInput> {
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: ticketIds },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId ?? '',
    }
  }
}
