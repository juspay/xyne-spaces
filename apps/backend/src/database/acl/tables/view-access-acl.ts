import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ViewAccessACL extends BaseQueryACL<
  Prisma.ViewAccessWhereInput,
  Prisma.ViewAccessUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ViewAccessWhereInput> {
    // Channel grants store the channelId in entityId, so a member of that channel
    // may read the grant. Resolve the caller's channel memberships up front.
    const channelIds = await this.getMemberChannelIds()
    return {
      OR: [
        // Directly shared with me
        { entityType: 'USER', entityId: this.ctx.userId },
        // Shared with a channel I'm a member of
        ...(channelIds.length
          ? [{ entityType: 'CHANNEL', entityId: { in: channelIds } }]
          : []),
        // Grants I created (as the sharer)
        { sharedBy: this.ctx.userId },
      ],
    }
  }

  private async getMemberChannelIds(): Promise<string[]> {
    const memberships = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    })
    return memberships.map(m => m.channelId)
  }

  async getMutateWhere(): Promise<Prisma.ViewAccessWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { entityType: 'USER', entityId: this.ctx.userId },
        { sharedBy: this.ctx.userId },
      ],
    }
  }

  async canCreate(data: Prisma.ViewAccessUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
