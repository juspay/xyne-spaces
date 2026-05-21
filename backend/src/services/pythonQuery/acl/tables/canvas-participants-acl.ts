import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasParticipantsACL extends BaseQueryACL<Prisma.CanvasParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasParticipantWhereInput | null> {
    const userGroupMappings = await this.prisma.userGroupMapping.findMany({
      where: { userId: this.ctx.userId },
      select: { userGroupId: true },
    });
    const userGroupIds = userGroupMappings.map(mapping => mapping.userGroupId);

    const groupParticipantWhere = userGroupIds.length
      ? ({ userGroupId: { in: userGroupIds } } satisfies Prisma.CanvasParticipantWhereInput)
      : null;

    return {
      OR: [
        { userId: this.ctx.userId },
        ...(groupParticipantWhere ? [groupParticipantWhere] : []),
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
            ],
          },
        },
      ],
    }
  }
}
