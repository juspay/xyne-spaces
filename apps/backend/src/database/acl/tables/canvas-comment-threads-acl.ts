import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * Canvas comment threads carry NO workspaceId column of their own — the tenant
 * boundary lives on the canvas they hang off. Scoping therefore has to traverse
 * the relation; a bare {} here would read as unrestricted and skip filtering
 * entirely.
 */
export class CanvasCommentThreadsACL extends BaseQueryACL<
  Prisma.CanvasCommentThreadWhereInput,
  Prisma.CanvasCommentThreadUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return { canvas: { workspaceId: this.ctx.workspaceId } }
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return { canvas: { workspaceId: this.ctx.workspaceId } }
  }

  async canCreate(data: Prisma.CanvasCommentThreadUncheckedCreateInput): Promise<boolean> {
    const canvas = await this.prisma.canvas.findFirst({
      where: { id: data.canvasId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return canvas !== null
  }
}
