import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Canvas comments carry NO workspaceId column — the tenant boundary is reached
 * through thread -> canvas. Filtering has to traverse that relation; a bare {}
 * would read as unrestricted and skip scoping altogether.
 *
 * canvasId is denormalised onto the row as well, but the thread relation is the
 * authoritative path (a comment cannot exist without its thread), so the filter
 * goes through it and creates validate both.
 */
export class CanvasCommentsACL extends BaseQueryACL<
  Prisma.CanvasCommentWhereInput,
  Prisma.CanvasCommentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentWhereInput> {
    return { thread: { canvas: { workspaceId: this.ctx.workspaceId } } }
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentWhereInput> {
    return { thread: { canvas: { workspaceId: this.ctx.workspaceId } } }
  }

  async canCreate(data: Prisma.CanvasCommentUncheckedCreateInput): Promise<boolean> {
    const thread = await this.prisma.canvasCommentThread.findFirst({
      where: {
        id: data.threadId,
        canvas: { workspaceId: this.ctx.workspaceId },
      },
      select: { canvasId: true },
    })
    if (!thread) return false
    // The row denormalises canvasId; refuse a value that disagrees with the thread.
    return thread.canvasId === data.canvasId
  }
}
