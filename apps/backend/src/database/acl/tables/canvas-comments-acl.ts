import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasCommentsACL extends BaseQueryACL<
  Prisma.CanvasCommentWhereInput,
  Prisma.CanvasCommentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentWhereInput> {
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { workspaceId: null, thread: { canvas: { workspaceId: this.ctx.workspaceId } } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentWhereInput> {
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { workspaceId: null, thread: { canvas: { workspaceId: this.ctx.workspaceId } } },
      ],
    }
  }

  async canCreate(data: Prisma.CanvasCommentUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId != null && data.workspaceId !== this.ctx.workspaceId) return false

    const thread = await this.prisma.canvasCommentThread.findFirst({
      where: {
        id: data.threadId,
        OR: [
          { workspaceId: this.ctx.workspaceId },
          { workspaceId: null, canvas: { workspaceId: this.ctx.workspaceId } },
        ],
      },
      select: { canvasId: true },
    })
    if (!thread) return false
    // The row denormalises canvasId; refuse a value that disagrees with the thread.
    return thread.canvasId === data.canvasId
  }
}
