import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleConversationIds } from './channel-access-helper'

export class ConversationParticipantsACL extends BaseQueryACL<Prisma.ConversationParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationParticipantWhereInput | null> {
    const accessibleConversationIds = await getAccessibleConversationIds(this.prisma, this.ctx.userId)

    return {
      conversationId: { in: accessibleConversationIds },
    }
  }
}
