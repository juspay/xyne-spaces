import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ExternalStepResponsesACL extends BaseQueryACL<Prisma.ExternalStepResponseWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ExternalStepResponseWhereInput | null> {
    return {
      workflowExecution: {
        workflow: {
          ticket: {
            channel: {
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
