import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class GlobalFieldsACL extends BaseQueryACL<
  Prisma.GlobalFieldWhereInput,
  Prisma.GlobalFieldUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.GlobalFieldWhereInput> {
    // Definitions are project-scoped; project.workspaceId keeps workspace isolation.
    return { project: { workspaceId: this.ctx.workspaceId } }
  }

  async getMutateWhere(): Promise<Prisma.GlobalFieldWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.GlobalFieldUncheckedCreateInput): Promise<boolean> {
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return project !== null
  }
}
