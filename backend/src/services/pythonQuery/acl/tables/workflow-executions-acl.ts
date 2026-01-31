import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleWorkflowIds } from './channel-access-helper'

export class WorkflowExecutionsACL extends BaseQueryACL<Prisma.WorkflowExecutionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowExecutionWhereInput | null> {
    const accessibleWorkflowIds = await getAccessibleWorkflowIds(this.prisma, this.ctx.userId)

    return {
      workflowId: { in: accessibleWorkflowIds },
    }
  }
}
