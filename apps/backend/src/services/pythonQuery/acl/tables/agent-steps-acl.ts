import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class AgentStepsACL extends BaseQueryACL<Prisma.AgentStepWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AgentStepWhereInput> {
    // AgentStep has no Prisma relation to WorkflowStep, so scope through the
    // linked workflow-step ids owned by this workspace.
    const workflowSteps = await this.prisma.workflowStep.findMany({
      where: {
        workflowExecution: {
          workflow: {
            workspaceId: this.ctx.workspaceId ?? '',
          },
        },
      },
      select: { id: true },
    })

    return {
      stepsId: { in: workflowSteps.map((step) => step.id) },
    }
  }
}
