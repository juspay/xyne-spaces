import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketUserMailboxACL extends BaseQueryACL<
  Prisma.TicketUserMailboxWhereInput,
  Prisma.TicketUserMailboxUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketUserMailboxWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketUserMailboxWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
