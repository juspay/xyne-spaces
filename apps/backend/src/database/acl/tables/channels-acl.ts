import { Prisma, PrismaClient } from '@prisma/client'
import { ChannelScopeType } from '@xyne/shared'
import { BaseQueryACL, ACLContext } from '../base-acl'
import {
  denyGuestWhere,
  getGuestAccessibleChannelIds,
  getGuestVisibleUserIds,
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
            { visibility: 'PUBLIC', NOT: { scopeType: { in: ['DM', 'GROUP_DM'] } } },
            { participants: { some: { userId: this.ctx.userId } } },
          ],
        },
        { workspaceId: this.ctx.workspaceId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelWhereInput> {
    if (this.ctx.role === 'GUEST') return denyGuestWhere('id')
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ChannelUncheckedCreateInput): Promise<boolean> {
    if (this.ctx.role === 'GUEST') return this.guestCanCreateDm(data)
    if (data.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
        select: { id: true },
      })
      if (!project) return false
    }
    return true
  }

  /**
   * A guest may open only a DM / group DM (e.g. to start a call with someone), and only
   * with themselves plus people they can already see. A DM's name is its members' sorted
   * ids (findOrCreateDMChannel; a self-DM is the bare id), so membership is checked here.
   */
  private async guestCanCreateDm(data: Prisma.ChannelUncheckedCreateInput): Promise<boolean> {
    if (data.scopeType !== ChannelScopeType.DM && data.scopeType !== ChannelScopeType.GROUP_DM) {
      return false
    }
    const memberIds = String(data.name ?? '').split(',').filter(Boolean)
    if (!memberIds.includes(this.ctx.userId)) return false
    const visible = new Set(
      await getGuestVisibleUserIds(this.prisma, this.ctx.workspaceId ?? '', this.ctx.userId),
    )
    return memberIds.every((id) => visible.has(id))
  }
}
