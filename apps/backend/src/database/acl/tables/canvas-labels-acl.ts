import { CanvasRole, CanvasVisibility } from '@xyne/shared'
import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleCanvasIds, isGuestContext } from './channel-access-helper'

const EDITOR_ROLES = [CanvasRole.OWNER, CanvasRole.EDITOR]

export class CanvasLabelsACL extends BaseQueryACL<
  Prisma.CanvasLabelWhereInput,
  Prisma.CanvasLabelUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  private async getActorGroupAndChannelIds(): Promise<{
    userGroupIds: string[]
    channelIds: string[]
  }> {
    const [groupMappings, channelMemberships] = await Promise.all([
      this.prisma.userGroupMapping.findMany({
        where: { userId: this.ctx.userId },
        select: { userGroupId: true },
      }),
      this.prisma.channelParticipant.findMany({
        where: { userId: this.ctx.userId },
        select: { channelId: true },
      }),
    ])

    return {
      userGroupIds: groupMappings.map(mapping => mapping.userGroupId),
      channelIds: channelMemberships.map(membership => membership.channelId),
    }
  }

  private async getVisibleCanvasWhere(): Promise<Prisma.CanvasWhereInput> {
    const { userGroupIds, channelIds } = await this.getActorGroupAndChannelIds()

    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { createdBy: this.ctx.userId },
        { visibility: CanvasVisibility.PUBLIC },
        { participants: { some: { userId: this.ctx.userId } } },
        ...(userGroupIds.length
          ? [{ participants: { some: { userGroupId: { in: userGroupIds } } } }]
          : []),
        ...(channelIds.length
          ? [
              { participants: { some: { channelId: { in: channelIds } } } },
              { channelId: { in: channelIds } },
            ]
          : []),
      ],
    }
  }

  private async getEditableCanvasWhere(): Promise<Prisma.CanvasWhereInput> {
    const { userGroupIds, channelIds } = await this.getActorGroupAndChannelIds()

    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { createdBy: this.ctx.userId },
        {
          participants: {
            some: { userId: this.ctx.userId, role: { in: EDITOR_ROLES } },
          },
        },
        ...(userGroupIds.length
          ? [
              {
                participants: {
                  some: { userGroupId: { in: userGroupIds }, role: { in: EDITOR_ROLES } },
                },
              },
            ]
          : []),
        ...(channelIds.length
          ? [
              {
                participants: {
                  some: { channelId: { in: channelIds }, role: { in: EDITOR_ROLES } },
                },
              },
            ]
          : []),
      ],
    }
  }

  async getWhereClause(): Promise<Prisma.CanvasLabelWhereInput> {
    if (isGuestContext(this.ctx)) {
      const canvasIds = await getGuestAccessibleCanvasIds(
        this.prisma,
        this.ctx.workspaceId,
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId,
        canvasId: { in: canvasIds },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
      canvas: await this.getVisibleCanvasWhere(),
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasLabelWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      canvas: await this.getEditableCanvasWhere(),
    }
  }

  async canCreate(data: Prisma.CanvasLabelUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) {
      return false
    }

    const canvas = await this.prisma.canvas.findFirst({
      where: {
        id: data.canvasId,
        ...(await this.getEditableCanvasWhere()),
      },
      select: { id: true },
    })

    return Boolean(canvas)
  }
}
