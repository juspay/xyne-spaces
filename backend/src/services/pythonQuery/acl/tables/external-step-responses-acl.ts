import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleWorkflowExecutionIds } from './channel-access-helper'

export class ExternalStepResponsesACL extends BaseQueryACL<Prisma.ExternalStepResponseWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ExternalStepResponseWhereInput | null> {
    const accessibleExecutionIds = await getAccessibleWorkflowExecutionIds(this.prisma, this.ctx.userId)

    return {
      workflowExecutionId: { in: accessibleExecutionIds },
    }
  }
}
