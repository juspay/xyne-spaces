import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getConnectAccessibleChannelIds,
  getGuestAccessibleChannelIds,
  isGuestContext,
} from './channel-access-helper'

export class BoardsACL extends BaseQueryACL<
  Prisma.BoardWhereInput,
  Prisma.BoardUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardWhereInput> {
    const ctx = this.ctx
    // Slack-Connect: boards mapped to a connect channel the caller is an active member of.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    const connectClause: Prisma.BoardWhereInput[] = connectChannelIds.length
      ? [{ channelMappings: { some: { channelId: { in: connectChannelIds } } } }]
      : []

    if (isGuestContext(ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        OR: [
          {
            workspaceId: this.ctx.workspaceId ?? '',
            channelMappings: {
              some: {
                channelId: { in: channelIds },
              },
            },
          },
          ...connectClause,
        ],
      }
    }

    // Direct workspaceId check - no need to traverse through project
    return {
      OR: [{ workspaceId: this.ctx.workspaceId }, ...connectClause],
    }
  }

  async getMutateWhere(): Promise<Prisma.BoardWhereInput> {
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)
    if (connectChannelIds.length === 0) {
      return { workspaceId: this.ctx.workspaceId }
    }
    return {
      OR: [
        { workspaceId: this.ctx.workspaceId },
        { channelMappings: { some: { channelId: { in: connectChannelIds } } } },
      ],
    }
  }

  async canCreate(data: Prisma.BoardUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return project !== null
  }
}
