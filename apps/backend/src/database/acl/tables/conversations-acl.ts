import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ConversationsACL extends BaseQueryACL<
  Prisma.ConversationWhereInput,
  Prisma.ConversationUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationWhereInput> {
    return {
      channel: {
        AND: [
          { workspaceId: this.ctx.workspaceId },
          {
            OR: [
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
            ],
          },
        ],
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.ConversationWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ConversationUncheckedCreateInput): Promise<boolean> {
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, workspaceId: this.ctx.workspaceId },
      select: { isArchived: true, visibility: true },
    })
    if (!channel) return false
    if (channel.isArchived) return false
    if (channel.visibility === 'PUBLIC') return true
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: data.channelId, userId: this.ctx.userId },
      select: { id: true },
    })
    return participant !== null
  }
}
