import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class TicketsACL extends BaseQueryACL<
  Prisma.TicketWhereInput,
  Prisma.TicketUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.TicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      project: {
        channels: {
          some: {
            participants: { some: { userId: this.ctx.userId } },
          },
        },
      },
    }
  }

  async canCreate(data: Prisma.TicketUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId },
      select: { isArchived: true },
    })
    if (channel?.isArchived) return false
    const participant = await this.prisma.channel.findFirst({
      where: {
        projectId: data.projectId,
        participants: { some: { userId: this.ctx.userId } },
      },
      select: { id: true },
    })
    return participant !== null
  }
}
