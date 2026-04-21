import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketStageEtaACL extends BaseQueryACL<Prisma.TicketStageEtaWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketStageEtaWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId ?? '' },
    }
  }
}
