import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CallsACL extends BaseQueryACL<
  Prisma.CallWhereInput,
  Prisma.CallUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallWhereInput> {
    return {
      AND: [
        {
          OR: [
            { createdByUserId: this.ctx.userId },
            { participants: { some: { userId: this.ctx.userId } } },
            { channel: { participants: { some: { userId: this.ctx.userId } } } },
          ],
        },
        { channel: { workspaceId: this.ctx.workspaceId } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CallWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { createdByUserId: this.ctx.userId },
        { participants: { some: { userId: this.ctx.userId } } },
      ],
    }
  }

  async canCreate(data: Prisma.CallUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    if (!data.channelId) return data.createdByUserId === this.ctx.userId
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, workspaceId: this.ctx.workspaceId, isArchived: false },
      select: { id: true },
    })
    if (!channel) return false
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: data.channelId, userId: this.ctx.userId },
      select: { id: true },
    })
    return participant !== null
  }
}
