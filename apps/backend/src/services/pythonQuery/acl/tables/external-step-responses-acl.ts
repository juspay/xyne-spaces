import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleTicketIds, isGuestContext } from './channel-access-helper'

export class ExternalStepResponsesACL extends BaseQueryACL<Prisma.ExternalStepResponseWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ExternalStepResponseWhereInput> {
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
      workflowExecution: {
        workflow: {
          ticket: {
            project: { workspaceId: this.ctx.workspaceId ?? '' },
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
