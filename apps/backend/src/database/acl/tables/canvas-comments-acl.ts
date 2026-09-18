import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { resolveReachableConnectIds, ConnectAclOp } from '../../connectGroup'

/**
 * Canvas comments carry NO workspaceId column — the tenant boundary is reached through
 * thread -> canvas. Slack Connect: a comment is reachable when its own `connectId` is in the
 * workspace's connect_group reach; comments with no connectId fall back to the parent
 * thread -> canvas workspaceId (the pre-Connect path), which is also the fallback if the
 * connect_group lookup fails. A bare {} would read as unrestricted and skip scoping altogether.
 *
 * canvasId is denormalised onto the row as well, but the thread relation is the authoritative
 * path (a comment cannot exist without its thread), so the fallback goes through it and creates
 * validate both.
 */
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
