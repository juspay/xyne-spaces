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

  async getWhereClause(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    // Slack Connect: connectId → connect_group workspace truth; else the row's own workspaceId.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comment_threads', 'read')
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_comment_threads', 'write')
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
