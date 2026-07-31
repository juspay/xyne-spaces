import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReactionsACL extends BaseQueryACL<
  Prisma.ReactionWhereInput,
  Prisma.ReactionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionWhereInput> {
    return {
      message: {
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
    }
  }

  async getMutateWhere(): Promise<Prisma.ReactionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { userId: this.ctx.userId },
        { message: { senderId: this.ctx.userId } },
      ],
    }
  }

  async canCreate(data: Prisma.ReactionUncheckedCreateInput): Promise<boolean> {
    const message = await this.prisma.message.findFirst({
      where: { messageId: data.messageId },
      select: {
        conversation: {
          select: {
            channel: {
              select: {
                workspaceId: true,
                visibility: true,
                participants: {
                  where: { userId: this.ctx.userId },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    })
    const channel = message?.conversation?.channel
    if (!channel) return false
    if (channel.workspaceId !== this.ctx.workspaceId) return false
    if (channel.visibility === 'PUBLIC') return true
    return channel.participants.length > 0
  }
}
