import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getGuestAccessibleCanvasIds,
  getConnectAccessibleChannelIds,
  isGuestContext,
} from './channel-access-helper'

export class CanvasesACL extends BaseQueryACL<
  Prisma.CanvasWhereInput,
  Prisma.CanvasUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasWhereInput> {
    // Slack-Connect: canvases on connect channels the caller is an active member of.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)

    if (isGuestContext(this.ctx)) {
      const canvasIds = await getGuestAccessibleCanvasIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        OR: [{ id: { in: canvasIds } }, { channelId: { in: connectChannelIds } }],
      }
    }

    return {
      OR: [{ workspaceId: this.ctx.workspaceId }, { channelId: { in: connectChannelIds } }],
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasWhereInput> {
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    return {
      OR: [{ workspaceId: this.ctx.workspaceId }, { channelId: { in: connectChannelIds } }],
    }
  }

  async canCreate(data: Prisma.CanvasUncheckedCreateInput): Promise<boolean> {
    if (data.channelId) {
      // Slack-Connect: an active connect member may create canvases on the host channel cross-org.
      const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
      if (connectChannelIds.includes(data.channelId as string)) {
        return true
      }
      const channel = await this.prisma.channel.findFirst({
        where: { id: data.channelId, workspaceId: this.ctx.workspaceId },
        select: { isArchived: true },
      })
      if (!channel) return false
      if (channel.isArchived) return false
      const participant = await this.prisma.channelParticipant.findFirst({
        where: { channelId: data.channelId, userId: this.ctx.userId },
        select: { id: true },
      })
      return participant !== null
    }
    if (data.projectId) {
      const membership = await this.prisma.channel.findFirst({
        where: {
          projectId: data.projectId,
          participants: { some: { userId: this.ctx.userId } },
        },
        select: { id: true },
      })
      return membership !== null
    }
    return true
  }
}
