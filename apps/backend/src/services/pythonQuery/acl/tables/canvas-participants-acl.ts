import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleCanvasIds, isGuestContext } from './channel-access-helper'

export class CanvasParticipantsACL extends BaseQueryACL<Prisma.CanvasParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasParticipantWhereInput | null> {
    if (isGuestContext(this.ctx)) {
      const canvasIds = await getGuestAccessibleCanvasIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        OR: [
          { userId: this.ctx.userId },
          { canvasId: { in: canvasIds } },
        ],
      }
    }

    const userGroupMappings = await this.prisma.userGroupMapping.findMany({
      where: { userId: this.ctx.userId },
      select: { userGroupId: true },
    });
    const userGroupIds = userGroupMappings.map(mapping => mapping.userGroupId);

    const groupParticipantWhere = userGroupIds.length
      ? ({ userGroupId: { in: userGroupIds } } satisfies Prisma.CanvasParticipantWhereInput)
      : null;

    const channelMemberships = await this.prisma.channelParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { channelId: true },
    });
    const channelIds = channelMemberships.map(c => c.channelId);
    const channelParticipantWhere = channelIds.length
      ? ({ channelId: { in: channelIds } } satisfies Prisma.CanvasParticipantWhereInput)
      : null;

    return {
      OR: [
        { userId: this.ctx.userId },
        ...(groupParticipantWhere ? [groupParticipantWhere] : []),
        ...(channelParticipantWhere ? [channelParticipantWhere] : []),
        {
          canvas: {
            OR: [
              { createdBy: this.ctx.userId },
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
              ...(groupParticipantWhere
                ? [
                    {
                      participants: {
                        some: groupParticipantWhere,
                      },
                    },
                  ]
                : []),
              ...(channelParticipantWhere
                ? [
                    {
                      participants: {
                        some: channelParticipantWhere,
                      },
                    },
                  ]
                : []),
            ],
          },
        },
      ],
    }
  }
}
