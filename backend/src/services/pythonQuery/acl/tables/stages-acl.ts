import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class StagesACL extends BaseQueryACL<Prisma.StageWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.StageWhereInput> {
    // Direct workspaceId check through board - no need to traverse through project
    return {
      board: {
        workspaceId: this.ctx.workspaceId ?? '',
        project: {
          channels: {
            some: {
              OR: [
                { visibility: 'PUBLIC' },
                { participants: { some: { userId: this.ctx.userId } } },
              ],
            },
          },
        },
      },
    }
  }
}
