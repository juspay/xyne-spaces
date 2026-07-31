import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

const AUTOMATION_WORKFLOW_TYPE = 'Automations'

export class WorkflowsACL extends BaseQueryACL<
  Prisma.WorkflowWhereInput,
  Prisma.WorkflowUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowWhereInput> {
    // Scope by the direct, indexed Workflow.workspaceId column so both the
    // ticket-linked and automation (ticketId=null) rows stay workspace-scoped.
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.WorkflowWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      workflowType: AUTOMATION_WORKFLOW_TYPE,
    }
  }

  async canCreate(data: Prisma.WorkflowUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    if (data.workflowType === AUTOMATION_WORKFLOW_TYPE) return true
    if (!data.ticketId) return false
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: data.ticketId },
      select: { projectId: true },
    })
    if (!ticket) return false
    const participant = await this.prisma.channel.findFirst({
      where: {
        projectId: ticket.projectId,
        participants: { some: { userId: this.ctx.userId } },
      },
      select: { id: true },
    })
    return participant !== null
  }
}
