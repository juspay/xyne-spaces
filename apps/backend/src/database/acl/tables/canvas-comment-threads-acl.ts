import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasCommentThreadsACL extends BaseQueryACL<
  Prisma.CanvasCommentThreadWhereInput,
  Prisma.CanvasCommentThreadUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { workspaceId: null, canvas: { workspaceId: this.ctx.workspaceId } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasCommentThreadWhereInput> {
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { workspaceId: null, canvas: { workspaceId: this.ctx.workspaceId } },
      ],
    }
  }

  async canCreate(data: Prisma.CanvasCommentThreadUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId != null && data.workspaceId !== this.ctx.workspaceId) return false

    const canvas = await this.prisma.canvas.findFirst({
      where: { id: data.canvasId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return canvas !== null
  }
}
