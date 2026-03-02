import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasParticipantsACL extends BaseQueryACL<Prisma.CanvasParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasParticipantWhereInput | null> {
    return {
      OR: [
        { userId: this.ctx.userId },
        {
          canvas: {
            OR: [
              { createdBy: this.ctx.userId },
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
            ],
          },
        },
      ],
    }
  }
}
