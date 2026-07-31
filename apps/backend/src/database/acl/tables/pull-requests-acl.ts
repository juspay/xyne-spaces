import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class PullRequestsACL extends BaseQueryACL<
  Prisma.PullRequestsWhereInput,
  Prisma.PullRequestsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.PullRequestsWhereInput | null> {
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

  async getMutateWhere(): Promise<Prisma.PullRequestsWhereInput> {
    return { id: { in: [] } }
  }

  async canCreate(_data: Prisma.PullRequestsUncheckedCreateInput): Promise<boolean> {
    return false
  }
}
