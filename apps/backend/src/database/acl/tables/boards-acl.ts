import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasProjectAdminAccess } from '../admin-access'

export class BoardsACL extends BaseQueryACL<
  Prisma.BoardWhereInput,
  Prisma.BoardUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardWhereInput> {
    // Direct workspaceId check - no need to traverse through project
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.BoardWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await hasProjectAdminAccess(this.prisma, this.ctx.userId)) {
      return { workspaceId }
    }
    return { workspaceId, createdBy: this.ctx.userId }
  }

  async canCreate(data: Prisma.BoardUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    if (!project) return false
    if (await hasProjectAdminAccess(this.prisma, this.ctx.userId)) return true
    const channel = await this.prisma.channel.findFirst({
      where: {
        projectId: data.projectId,
        participants: { some: { userId: this.ctx.userId } },
      },
      select: { id: true },
    })
    return channel !== null
  }
}
