import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelParticipantsACL extends BaseQueryACL<Prisma.ChannelParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelParticipantWhereInput> {
    return {
      AND: [
        {
          OR: [
            { userId: this.ctx.userId },
            {
              channel: {
                OR: [
                  { visibility: 'PUBLIC' },
                  { participants: { some: { userId: this.ctx.userId } } },
                ],
              },
            },
          ],
        },
        { channel: { workspaceId: this.ctx.workspaceId ?? '' } },
      ],
    }
  }
}
