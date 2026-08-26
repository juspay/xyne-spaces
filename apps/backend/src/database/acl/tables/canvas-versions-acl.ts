import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getConnectAccessibleChannelIds } from './channel-access-helper'

export class CanvasVersionsACL extends BaseQueryACL<
  Prisma.CanvasVersionWhereInput,
  Prisma.CanvasVersionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Slack-Connect: version history of canvases on connect channels the caller is an
  // active member of, regardless of home workspace. canvas_versions has canvasId
  // (not channelId), so resolve accessible canvas ids from the connect channels.
  private async getConnectAccessibleCanvasIds(): Promise<string[]> {
    const connectChannelIds = await getConnectAccessibleChannelIds(
      this.prisma,
      this.ctx.userId,
    )
    if (connectChannelIds.length === 0) return []
    const canvases = await this.prisma.canvas.findMany({
      where: { channelId: { in: connectChannelIds } },
      select: { id: true },
    })
    return canvases.map(c => c.id)
  }

  async getWhereClause(): Promise<Prisma.CanvasVersionWhereInput> {
    const connectCanvasIds = await this.getConnectAccessibleCanvasIds()
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { canvasId: { in: connectCanvasIds } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasVersionWhereInput> {
    const connectCanvasIds = await this.getConnectAccessibleCanvasIds()
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { canvasId: { in: connectCanvasIds } },
      ],
    }
  }

  async canCreate(data: Prisma.CanvasVersionUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId === this.ctx.workspaceId) return true
    // A connect member may write versions for canvases on the shared channel.
    const connectCanvasIds = await this.getConnectAccessibleCanvasIds()
    return connectCanvasIds.includes(data.canvasId as string)
  }
}
