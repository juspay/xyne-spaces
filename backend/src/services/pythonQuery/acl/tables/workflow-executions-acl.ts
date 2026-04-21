import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class WorkflowExecutionsACL extends BaseQueryACL<Prisma.WorkflowExecutionWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.WorkflowExecutionWhereInput> {
    const workspaceId = this.ctx.workspaceId ?? '';

    const workspaceUsers = await this.prisma.user.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    const workspaceUserIds = workspaceUsers.map((u) => u.id);

    return {
      createdBy: { in: workspaceUserIds },
      // TODO: need to add check with WorkflowExecutionUsers table as its not public currenlty
    }
  }
}

