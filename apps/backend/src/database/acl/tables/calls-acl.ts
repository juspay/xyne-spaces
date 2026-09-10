import { Prisma, PrismaClient } from '@prisma/client'
import { CallType, CallVisibility, EntityUserAccess, ShareableEntityType } from '@xyne/shared'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class CallsACL extends BaseQueryACL<
  Prisma.CallWhereInput,
  Prisma.CallUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  /**
   * Ids of calls (headless recordings) shared with `ctx.userId` via `entity_access`
   * (NOTE_TAKER), directly or through a userGroup/channel they belong to. `entityId`
   * has no FK to `calls.id` (polymorphic), so this can't be expressed as a Prisma
   * relation and is resolved as a separate lookup instead — mirrors the Zero-side
   * `CallsACL.canSelect` `exists('shares', ...)` clause.
   */
  private async getSharedCallIds(): Promise<string[]> {
    const [groupMappings, channelParticipations] = await Promise.all([
      this.prisma.userGroupMapping.findMany({
        where: { userId: this.ctx.userId },
        select: { userGroupId: true },
      }),
      this.prisma.channelParticipant.findMany({
        where: { userId: this.ctx.userId },
        select: { channelId: true },
      }),
    ])
    const userGroupIds = groupMappings.map((m) => m.userGroupId)
    const channelIds = channelParticipations.map((p) => p.channelId)

    const shares = await this.prisma.entityAccess.findMany({
      where: {
        workspaceId: this.ctx.workspaceId,
        shareableEntityType: ShareableEntityType.NOTE_TAKER,
        entityUserAccess: { not: EntityUserAccess.REVOKED },
        OR: [
          { userId: this.ctx.userId },
          ...(userGroupIds.length ? [{ userGroupId: { in: userGroupIds } }] : []),
          ...(channelIds.length ? [{ channelId: { in: channelIds } }] : []),
        ],
      },
      select: { entityId: true },
    })
    return shares.map((s) => s.entityId)
  }

  async getWhereClause(): Promise<Prisma.CallWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        channel: {
          workspaceId: this.ctx.workspaceId ?? '',
          id: { in: channelIds },
        },
      }
    }

    const sharedCallIds = await this.getSharedCallIds()

    return {
      AND: [
        {
          OR: [
            { createdByUserId: this.ctx.userId },
            { participants: { some: { userId: this.ctx.userId } } },
            { channel: { participants: { some: { userId: this.ctx.userId } } } },
            ...(sharedCallIds.length
              ? [{ callType: CallType.HEADLESS, id: { in: sharedCallIds } }]
              : []),
            { callType: CallType.HEADLESS, visibility: CallVisibility.PUBLIC },
          ],
        },
        { workspaceId: this.ctx.workspaceId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CallWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { createdByUserId: this.ctx.userId },
        { participants: { some: { userId: this.ctx.userId } } },
      ],
    }
  }

  async canCreate(data: Prisma.CallUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    if (!data.channelId) return data.createdByUserId === this.ctx.userId
    const channel = await this.prisma.channel.findFirst({
      where: { id: data.channelId, workspaceId: this.ctx.workspaceId, isArchived: false },
      select: { id: true },
    })
    if (!channel) return false
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: data.channelId, userId: this.ctx.userId },
      select: { id: true },
    })
    return participant !== null
  }
}
