import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleCanvasIds, isGuestContext } from './channel-access-helper'

export class CanvasesACL extends BaseQueryACL<
  Prisma.CanvasWhereInput,
  Prisma.CanvasUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasWhereInput> {
    if (isGuestContext(this.ctx)) {
      const canvasIds = await getGuestAccessibleCanvasIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        id: { in: canvasIds },
      }
    }

    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.CanvasWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.CanvasUncheckedCreateInput): Promise<boolean> {
    if (data.channelId) {
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
