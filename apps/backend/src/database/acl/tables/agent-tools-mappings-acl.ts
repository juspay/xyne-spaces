import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class AgentToolsMappingsACL extends BaseQueryACL<
  Prisma.AgentToolsMappingWhereInput,
  Prisma.AgentToolsMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AgentToolsMappingWhereInput> {
    const agents = await this.prisma.agent.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { agentId: { in: agents.map((a) => a.id) } }
  }

  async getMutateWhere(): Promise<Prisma.AgentToolsMappingWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.AgentToolsMappingUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
