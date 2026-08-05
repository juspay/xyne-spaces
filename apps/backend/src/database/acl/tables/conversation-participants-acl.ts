import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ConversationParticipantsACL extends BaseQueryACL<
  Prisma.ConversationParticipantWhereInput,
  Prisma.ConversationParticipantUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationParticipantWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        conversation: {
          channel: {
            workspaceId: this.ctx.workspaceId ?? '',
            id: { in: channelIds },
          },
        },
      }
    }

    return {
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
    }
  }

  async getMutateWhere(): Promise<Prisma.ConversationParticipantWhereInput> {
    // Writes match reads: a workspace-only clause here would let any member mutate rows
    // belonging to channels they cannot read.
    return this.getWhereClause()
  }

  async canCreate(data: Prisma.ConversationParticipantUncheckedCreateInput): Promise<boolean> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { conversationId: data.conversationId, workspaceId: this.ctx.workspaceId },
      select: { channelId: true, channel: { select: { isArchived: true, visibility: true } } },
    })
    if (!conversation) return false
    if (conversation.channel?.isArchived) return false
    if (conversation.channel?.visibility === 'PUBLIC') return true
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: conversation.channelId, userId: this.ctx.userId },
      select: { id: true },
    })
    return participant !== null
  }
}
