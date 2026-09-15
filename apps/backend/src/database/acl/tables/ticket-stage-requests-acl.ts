import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketStageRequestsACL extends BaseQueryACL<
  Prisma.TicketStageRequestWhereInput,
  Prisma.TicketStageRequestUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketStageRequestWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketStageRequestWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
