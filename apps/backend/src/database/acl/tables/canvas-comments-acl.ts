import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { connectReachWhere } from '../../connectGroup'

/** Canvas comments are tenant-scoped directly by their denormalized workspaceId. */
export class CanvasCommentsACL extends BaseQueryACL<
  Prisma.CanvasCommentWhereInput,
  Prisma.CanvasCommentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentWhereInput> {
    // Slack Connect: connectId → connect_group workspace truth; else the row's own workspaceId.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comments', 'read')
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentWhereInput> {
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comments', 'write')
  }

  async canCreate(data: Prisma.CanvasCommentUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false

    const thread = await this.prisma.canvasCommentThread.findFirst({
      where: {
        id: data.threadId,
        workspaceId: this.ctx.workspaceId,
      },
      select: { canvasId: true },
    })
    if (!thread) return false
    // The row denormalises canvasId; refuse a value that disagrees with the thread.
    return thread.canvasId === data.canvasId
  }
}
