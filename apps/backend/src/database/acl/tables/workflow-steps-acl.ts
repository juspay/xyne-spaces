import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class WorkflowStepsACL extends BaseQueryACL<Prisma.WorkflowStepWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowStepWhereInput> {
    return {
      workflowExecution: {
        workflow: {
          workspaceId: this.ctx.workspaceId,
        },
      },
    }
  }
}
