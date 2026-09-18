import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { resolveReachableConnectIds, ConnectAclOp } from '../../connectGroup'

/**
 * Canvas comment threads carry NO workspaceId column of their own — the tenant
 * boundary lives on the canvas they hang off. Slack Connect: a thread is reachable when its own
 * `connectId` is in the workspace's connect_group reach; threads with no connectId fall back to
 * the parent canvas's workspaceId (the pre-Connect path), which is also the fallback if the
 * connect_group lookup fails. A bare {} would read as unrestricted and skip filtering entirely.
 */
export class CanvasCommentThreadsACL extends BaseQueryACL<
  Prisma.CanvasCommentThreadWhereInput,
  Prisma.CanvasCommentThreadUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  private async reachWhere(op: ConnectAclOp): Promise<Prisma.CanvasCommentThreadWhereInput> {
    const parent: Prisma.CanvasCommentThreadWhereInput = {
      canvas: { workspaceId: this.ctx.workspaceId },
    }
    const { ids, ok } = await resolveReachableConnectIds(
      this.prisma,
      this.ctx.workspaceId,
      'canvas_comment_threads',
      op,
    )
    return ok
      ? { OR: [{ connectId: { in: ids } }, { connectId: null, ...parent }] }
      : parent
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return this.reachWhere('read')
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return this.reachWhere('write')
  }

  async canCreate(data: Prisma.CanvasCommentThreadUncheckedCreateInput): Promise<boolean> {
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: data.canvasId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return canvas !== null
  }
}
