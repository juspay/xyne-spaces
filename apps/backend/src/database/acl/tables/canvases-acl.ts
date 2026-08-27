import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleCanvasIds, isGuestContext } from './channel-access-helper'
import { getUserGroupIds } from './user-group-helper'

/**
 * Non-guest reads are scoped to workspace + reachable canvases:
 * creator, PUBLIC, or explicit user/group/channel share.
 * Home-channel membership is intentionally excluded; private call/summary
 * canvases must be shared through CanvasParticipant rows.
 */
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

    const userId = this.ctx.userId

    // Parallel: this runs on every per-user canvas read. Zero's equivalent filter needs no
    // lookups, but CanvasParticipant has no userGroup/channel relation to traverse here.
    const [userGroupIds, channelParticipations] = await Promise.all([
      getUserGroupIds(this.prisma, userId),
      this.prisma.channelParticipant.findMany({
        where: { userId },
        select: { channelId: true },
      }),
    ])
    const channelIds = channelParticipations.map((c) => c.channelId)

    const participantMatchers: Prisma.CanvasParticipantWhereInput[] = [{ userId }]
    if (userGroupIds.length) participantMatchers.push({ userGroupId: { in: userGroupIds } })
    if (channelIds.length) participantMatchers.push({ channelId: { in: channelIds } })

    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { createdBy: userId },
        { visibility: 'PUBLIC' },
        { participants: { some: { OR: participantMatchers } } },
      ],
    }
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
