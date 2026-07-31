import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SurfaceLinksACL extends BaseQueryACL<
  Prisma.SurfaceLinkWhereInput,
  Prisma.SurfaceLinkUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SurfaceLinkWhereInput> {
    // sourceId polymorphically references messages/tickets/canvases by sourceType.
    // Scope to messages belonging to workspace-owned conversations.
    // Non-message sources still bypass this filter — analytics endpoint enforces
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

  async getMutateWhere(): Promise<Prisma.SurfaceLinkWhereInput> {
    return { workspaceId: this.ctx.workspaceId, id: { in: [] } }
  }

  async canCreate(data: Prisma.SurfaceLinkUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    return data.createdBy === this.ctx.userId
  }
}
