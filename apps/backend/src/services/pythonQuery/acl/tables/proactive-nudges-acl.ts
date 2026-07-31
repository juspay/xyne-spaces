import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ProactiveNudgesACL extends BaseQueryACL<Prisma.ProactiveNudgeWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ProactiveNudgeWhereInput> {
    // Scope via message → conversation.workspaceId
    // (Conversation has denormalized workspaceId per XYNE-11716).
    const conversations = await this.prisma.conversation.findMany({
      where: { workspaceId: this.ctx.workspaceId ?? '' },
      select: { conversationId: true },
    })
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: conversations.map((c) => c.conversationId) } },
      select: { messageId: true },
    })
    return { messageId: { in: messages.map((m) => m.messageId) } }
  }
}
