import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class MessagesACL extends BaseQueryACL<
  Prisma.MessageWhereInput,
  Prisma.MessageUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.MessageWhereInput> {
    return {
      AND: [
        {
          OR: [{ visibleTo: null }, { visibleTo: this.ctx.userId }],
        },
        {
          conversation: {
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
          },
        },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.MessageWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ senderId: this.ctx.userId }, { msgType: 'SYSTEM' }],
    }
  }

  async canCreate(data: Prisma.MessageUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const conversation = await this.prisma.conversation.findFirst({
      where: { conversationId: data.conversationId },
      select: {
        channel: {
          select: { id: true, isArchived: true, visibility: true, workspaceId: true },
        },
      },
    })
    if (!conversation || !conversation.channel) return false
    if (conversation.channel.isArchived) return false
    if (conversation.channel.workspaceId !== this.ctx.workspaceId) return false
    if (conversation.channel.visibility === 'PUBLIC') return true
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: conversation.channel.id, userId: this.ctx.userId },
      select: { id: true },
    })
    return participant !== null
  }
}
