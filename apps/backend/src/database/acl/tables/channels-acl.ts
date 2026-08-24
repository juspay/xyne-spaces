import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ChannelsACL extends BaseQueryACL<
  Prisma.ChannelWhereInput,
  Prisma.ChannelUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: channelIds },
      }
    }

    return {
      AND: [
        {
          OR: [
            { visibility: 'PUBLIC' },
            { participants: { some: { userId: this.ctx.userId } } },
          ],
        },
        { workspaceId: this.ctx.workspaceId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ChannelUncheckedCreateInput): Promise<boolean> {
    // DM channels are not project-owned product channels. The bot-DM app route
    // creates them with the historical sentinel projectId `default`; requiring
    // that to be a real Project makes /api/apps/channel/openDm fail at the ACL
    // layer before participants can be added.
    if (data.scopeType === 'DM' || data.scopeType === 'GROUP_DM') return true

    if (data.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
        select: { id: true },
      })
      if (!project) return false
    }
    return true
  }
}
