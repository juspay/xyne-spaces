import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketAssignmentsACL extends BaseQueryACL<
  Prisma.TicketAssignmentWhereInput,
  Prisma.TicketAssignmentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketAssignmentWhereInput> {
    return {
      ticket: { workspaceId: this.ctx.workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketAssignmentWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.TicketAssignmentUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: data.ticketId, workspaceId: this.ctx.workspaceId },
      select: { projectId: true },
    })
    if (!ticket) return false
    const channel = await this.prisma.channel.findFirst({
      where: {
        projectId: ticket.projectId,
        participants: { some: { userId: this.ctx.userId } },
      },
      select: { id: true },
    })
    return channel !== null
  }
}
