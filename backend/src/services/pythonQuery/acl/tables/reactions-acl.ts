import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleConversationIds } from './channel-access-helper'

export class ReactionsACL extends BaseQueryACL<Prisma.ReactionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReactionWhereInput | null> {
    // Get accessible conversation IDs
    const accessibleConversationIds = await getAccessibleConversationIds(this.prisma, this.ctx.userId)

    // Get message IDs from accessible conversations
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: accessibleConversationIds } },
      select: { messageId: true },
    })

    const accessibleMessageIds = messages.map((m) => m.messageId)

    return {
      messageId: { in: accessibleMessageIds },
    }
  }
}
