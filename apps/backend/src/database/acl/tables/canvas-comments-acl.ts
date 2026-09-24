import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { resolveReachableConnectIds, ConnectAclOp } from '../../connectGroup'

/** Canvas comments are tenant-scoped directly by their denormalized workspaceId. */
export class CanvasCommentsACL extends BaseQueryACL<
  Prisma.CanvasCommentWhereInput,
  Prisma.CanvasCommentUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  private async reachWhere(op: ConnectAclOp): Promise<Prisma.CanvasCommentWhereInput> {
    const parent: Prisma.CanvasCommentWhereInput = {
      thread: { canvas: { workspaceId: this.ctx.workspaceId } },
    }
    const { ids, ok } = await resolveReachableConnectIds(
      this.prisma,
      this.ctx.workspaceId,
      'canvas_comments',
      op,
    )
    return ok
      ? { OR: [{ connectId: { in: ids } }, { connectId: null, ...parent }] }
      : parent
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentWhereInput> {
    return this.reachWhere('read')
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentWhereInput> {
    return this.reachWhere('write')
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
