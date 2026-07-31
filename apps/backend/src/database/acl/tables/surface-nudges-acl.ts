import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SurfaceNudgesACL extends BaseQueryACL<
  Prisma.SurfaceNudgeWhereInput,
  Prisma.SurfaceNudgeUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SurfaceNudgeWhereInput> {
    // sourceId polymorphically references messages/tickets/canvases by nudgeKind.
    // Scope to messages belonging to workspace-owned conversations.
    // Non-message kinds still bypass this filter — analytics endpoint enforces
    // broader role/workspace gating.
    const conversations = await this.prisma.conversation.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { conversationId: true },
    })
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: conversations.map((c) => c.conversationId) } },
      select: { messageId: true },
    })
    return { sourceId: { in: messages.map((m) => m.messageId) } }
  }

  async getMutateWhere(): Promise<Prisma.SurfaceNudgeWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [{ visibleTo: null }, { visibleTo: this.ctx.userId }],
    }
  }

  async canCreate(_data: Prisma.SurfaceNudgeUncheckedCreateInput): Promise<boolean> {
    return false
  }
}
