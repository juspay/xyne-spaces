import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ApplicationReleaseTicketsACL extends BaseQueryACL<
  Prisma.ApplicationReleaseTicketWhereInput,
  Prisma.ApplicationReleaseTicketUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ApplicationReleaseTicketWhereInput> {
    // Scope via ticket.workspaceId (Ticket has denormalized workspaceId).
    const tickets = await this.prisma.ticket.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { ticketId: { in: tickets.map((t) => t.id) } }
  }

  async getMutateWhere(): Promise<Prisma.ApplicationReleaseTicketWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ApplicationReleaseTicketUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
