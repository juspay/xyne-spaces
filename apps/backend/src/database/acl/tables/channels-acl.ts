import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  getGuestAccessibleChannelIds,
  getConnectAccessibleChannelIds,
  isGuestContext,
} from './channel-access-helper'

export class ChannelsACL extends BaseQueryACL<
  Prisma.ChannelWhereInput,
  Prisma.ChannelUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelWhereInput> {
    const ctx = this.ctx
    // Slack-Connect: connect channels the caller is an active member of, across orgs.
    const connectChannelIds = await getConnectAccessibleChannelIds(this.prisma, this.ctx.userId)

    if (isGuestContext(ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        OR: [
          { workspaceId: this.ctx.workspaceId ?? '', id: { in: channelIds } },
          { id: { in: connectChannelIds } },
        ],
      }
    }

    return {
      OR: [
        {
          AND: [
            {
              OR: [
                { visibility: 'PUBLIC' },
                { participants: { some: { userId: this.ctx.userId } } },
              ],
            },
            { workspaceId: this.ctx.workspaceId },
          ],
        },
        { id: { in: connectChannelIds } },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ChannelUncheckedCreateInput): Promise<boolean> {
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
