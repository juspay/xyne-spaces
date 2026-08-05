import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ConversationsACL extends BaseQueryACL<
  Prisma.ConversationWhereInput,
  Prisma.ConversationUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        channel: {
          workspaceId: this.ctx.workspaceId ?? '',
          id: { in: channelIds },
        },
      }
    }

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
    // Writes match reads: a workspace-only clause here would let any member mutate rows
    // belonging to channels they cannot read.
    return this.getWhereClause()
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
