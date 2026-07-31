import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketStageEtaACL extends BaseQueryACL<
  Prisma.TicketStageEtaWhereInput,
  Prisma.TicketStageEtaUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketStageEtaWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketStageEtaWhereInput> {
    const workspaceId = this.ctx.workspaceId
    return {
      workspaceId,
      ticket: { workspaceId },
    }
  }

  async canCreate(data: Prisma.TicketStageEtaUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: data.ticketId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return ticket !== null
  }
}
