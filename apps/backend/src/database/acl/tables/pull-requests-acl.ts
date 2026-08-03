import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class PullRequestsACL extends BaseQueryACL<
  Prisma.PullRequestsWhereInput,
  Prisma.PullRequestsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.PullRequestsWhereInput | null> {
    if (isGuestContext(this.ctx)) {
      const ticketIds = await getAccessibleTicketIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workflowExecution: {
          workflow: {
            ticketId: { in: ticketIds },
          },
        },
      }
    }

    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.PullRequestsWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

}
