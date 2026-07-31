import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasVersionsACL extends BaseQueryACL<
  Prisma.CanvasVersionWhereInput,
  Prisma.CanvasVersionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasVersionWhereInput> {
    // Scope via canvas → channel.workspaceId (Channel has denormalized workspaceId).
    const channels = await this.prisma.channel.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    const canvases = await this.prisma.canvas.findMany({
      where: { channelId: { in: channels.map((c) => c.id) } },
      select: { id: true },
    })
    return { canvasId: { in: canvases.map((c) => c.id) } }
  }

  async getMutateWhere(): Promise<Prisma.CanvasVersionWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.CanvasVersionUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
