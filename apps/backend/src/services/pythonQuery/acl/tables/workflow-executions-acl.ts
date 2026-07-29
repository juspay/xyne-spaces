import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleWorkflowIds, isGuestContext } from './channel-access-helper'

export class WorkflowExecutionsACL extends BaseQueryACL<Prisma.WorkflowExecutionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowExecutionWhereInput> {
    if (isGuestContext(this.ctx)) {
      const workflowIds = await getAccessibleWorkflowIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        workflowId: { in: workflowIds },
      }
    }

    const workspaceId = this.ctx.workspaceId ?? '';

    // Scope executions by their parent workflow's workspace using the direct,
    // indexed `Workflow.workspaceId` column (indexes [workspaceId, eventType,
    // status] and [workspaceId, workflowType, createdAt]).
    //
    // NOTE: the previous implementation scoped by `createdBy IN workspaceUsers`,
    // which silently excluded every engine/event/webhook/cron-triggered
    // execution because those rows are created with `createdBy = null` — making
    // workflow-stats report 0 runs for all automations. Scoping through the
    // workflow's workspaceId counts system-created executions while keeping the
    // workspace boundary exact (no cross-workspace counting of ticketId-null
    // "global" automations).
    return {
      workflow: { workspaceId },
    }
  }
}
