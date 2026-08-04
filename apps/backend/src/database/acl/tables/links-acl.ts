import { ChannelVisibility, Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class LinksACL extends BaseQueryACL<
  Prisma.LinkWhereInput,
  Prisma.LinkUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  /**
   * Link carries a bare channelId with no relation to Channel, so the channel
   * gate cannot be traversed and has to be resolved to ids first.
   *
   * The member arm is written out rather than reusing getAccessibleChannelIds
   * because that helper narrows PUBLIC channels to the caller's projects, which
   * would make this layer stricter than the sync layer.
   */
  private async visibleChannelIds(): Promise<string[]> {
    if (isGuestContext(this.ctx)) {
      return getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)
    }

    // Mirrors the sync layer: PUBLIC anywhere in the workspace, or a channel the
    // caller participates in. Served by the (workspaceId, visibility, id) index.
    const channels = await this.prisma.channel.findMany({
      where: {
        workspaceId: this.ctx.workspaceId,
        OR: [
          { visibility: ChannelVisibility.PUBLIC },
          { participants: { some: { userId: this.ctx.userId } } },
        ],
      },
      select: { id: true },
    })

    return channels.map((channel) => channel.id)
  }

  async getWhereClause(): Promise<Prisma.LinkWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      channelId: { in: await this.visibleChannelIds() },
    }
  }

  /**
   * Writes stay workspace-scoped, matching the sync layer's link mutation rules.
   * Tightening one layer alone would put the two out of step.
   */
  async getMutateWhere(): Promise<Prisma.LinkWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.LinkUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
