import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketAssignmentsACL extends BaseQueryACL<Prisma.TicketAssignmentWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketAssignmentWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
