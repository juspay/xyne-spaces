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

  async getWhereClause(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasCommentWhereInput> {
    // Slack Connect: single-entity gate on the query's connectId/canvasId (comments are usually keyed
    // by threadId — then neither is present and this degrades to the row's own workspaceId).
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comments', 'read', {
      connectId: queryWhere?.connectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
  }

  async getMutateWhere(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasCommentWhereInput> {
    // Slack Connect: update/delete scope follows the same single-entity gate as reads.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comments', 'write', {
      connectId: queryWhere?.connectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
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
