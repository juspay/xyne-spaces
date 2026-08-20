import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class CallParticipantsACL extends BaseQueryACL<
  Prisma.CallParticipantWhereInput,
  Prisma.CallParticipantUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CallParticipantWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        call: {
          channel: {
            workspaceId: this.ctx.workspaceId ?? '',
            id: { in: channelIds },
          },
        },
      }
    }

    return {
      AND: [
        {
          call: {
            OR: [
              { createdByUserId: this.ctx.userId },
              { participants: { some: { userId: this.ctx.userId } } },
              {
                channel: {
                  visibility: 'PUBLIC',
                  participants: { some: { userId: this.ctx.userId } },
                },
              },
            ],
          },
        },
        // Scope on the row's own workspaceId, like getMutateWhere below. Going via
        // `call.channel` never matches when channelId is null (recordings), which
        // hid those participant rows from every read.
        { workspaceId: this.ctx.workspaceId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.CallParticipantWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.CallParticipantUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const call = await this.prisma.call.findFirst({
      where: { id: data.callId },
      select: { channelId: true },
    })
    if (!call || !call.channelId) return false
    const channel = await this.prisma.channel.findFirst({
      where: { id: call.channelId, workspaceId: this.ctx.workspaceId, isArchived: false },
      select: { id: true },
    })
    if (!channel) return false
    const participant = await this.prisma.channelParticipant.findFirst({
      where: { channelId: call.channelId, userId: this.ctx.userId },
      select: { id: true },
    })
    return participant !== null
  }
}
