import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { connectReachWhere } from '../../connectGroup'

/** Canvas comment threads are tenant-scoped directly by their denormalized workspaceId. */
export class CanvasCommentThreadsACL extends BaseQueryACL<
  Prisma.CanvasCommentThreadWhereInput,
  Prisma.CanvasCommentThreadUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasCommentThreadWhereInput> {
    // Slack Connect: single-entity gate on the query's connectId/canvasId; else the row's own workspaceId.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comment_threads', 'read', {
      connectId: queryWhere?.canvasConnectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
  }

  async getMutateWhere(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasCommentThreadWhereInput> {
    // Slack Connect: update/delete scope follows the same single-entity gate as reads.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comment_threads', 'write', {
      connectId: queryWhere?.canvasConnectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
  }

  async canCreate(data: Prisma.CanvasCommentThreadUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false

    const canvas = await this.prisma.canvas.findFirst({
      where: { id: data.canvasId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return canvas !== null
  }
}
