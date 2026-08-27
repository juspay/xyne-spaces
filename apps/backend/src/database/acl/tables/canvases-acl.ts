import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleCanvasIds, isGuestContext } from './channel-access-helper'

/**
 * ACL for the `canvas` model.
 *
 * The non-guest branch previously scoped to `workspaceId` only, so any
 * workspace member could read every canvas in the workspace via /api/query.
 * Canvases default to `visibility: PRIVATE`, which made private documents
 * readable by id.
 *
 * Now mirrors the (already-correct) `CanvasParticipantsACL`:
 *   - same workspace, AND
 *   - creator, OR PUBLIC, OR a direct/group/channel participant, OR the canvas
 *     lives in a channel the caller is a member of.
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

    const userGroupIds = (
      await this.prisma.userGroupMapping.findMany({
        where: { userId },
        select: { userGroupId: true },
      })
    ).map((m) => m.userGroupId)

    const channelIds = (
      await this.prisma.channelParticipant.findMany({
        where: { userId },
        select: { channelId: true },
      })
    ).map((c) => c.channelId)

    const participantMatchers: Prisma.CanvasParticipantWhereInput[] = [{ userId }]
    if (userGroupIds.length) participantMatchers.push({ userGroupId: { in: userGroupIds } })
    if (channelIds.length) participantMatchers.push({ channelId: { in: channelIds } })

    const or: Prisma.CanvasWhereInput[] = [
      { createdBy: userId },
      { visibility: 'PUBLIC' },
      { participants: { some: { OR: participantMatchers } } },
    ]
    if (channelIds.length) or.push({ channelId: { in: channelIds } })

    return {
      workspaceId: this.ctx.workspaceId,
      OR: or,
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
