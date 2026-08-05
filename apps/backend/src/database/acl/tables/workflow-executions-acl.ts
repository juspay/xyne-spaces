import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleWorkflowIds, isGuestContext } from './channel-access-helper'

export class WorkflowExecutionsACL extends BaseQueryACL<
  Prisma.WorkflowExecutionWhereInput,
  Prisma.WorkflowExecutionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowExecutionWhereInput> {
    const ctx = this.ctx
    if (isGuestContext(ctx)) {
      const workflowIds = await getAccessibleWorkflowIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workflowId: { in: workflowIds },
      }
    }

    const workspaceId = this.ctx.workspaceId;

    // Scope executions by their parent workflow's workspace using the direct,
    // indexed `Workflow.workspaceId` column. This also counts system-created
    // executions, whose createdBy is unset.
    return {
      workflow: { workspaceId },
    }
  }

  async getMutateWhere(): Promise<Prisma.WorkflowExecutionWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.WorkflowExecutionUncheckedCreateInput): Promise<boolean> {
    // createdBy is unset for system-triggered executions.
    if (!data.createdBy) return true
    const user = await this.prisma.user.findFirst({
      where: { id: data.createdBy, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return user !== null
  }
}
