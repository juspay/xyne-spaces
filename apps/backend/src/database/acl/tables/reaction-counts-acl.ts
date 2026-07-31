import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReactionCountsACL extends BaseQueryACL<
  Prisma.ReactionCountWhereInput,
  Prisma.ReactionCountUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionCountWhereInput> {
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

  async getMutateWhere(): Promise<Prisma.ReactionCountWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
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

  async canCreate(data: Prisma.ReactionCountUncheckedCreateInput): Promise<boolean> {
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
