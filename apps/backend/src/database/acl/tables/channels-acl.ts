import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ChannelsACL extends BaseQueryACL<
  Prisma.ChannelWhereInput,
  Prisma.ChannelUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ChannelWhereInput> {
    return {
      AND: [
        {
          OR: [
            { visibility: 'PUBLIC' },
            { participants: { some: { userId: this.ctx.userId } } },
          ],
        },
        { workspaceId: this.ctx.workspaceId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ChannelWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      participants: { some: { userId: this.ctx.userId } },
    }
  }

  async canCreate(data: Prisma.ChannelUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    if (data.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
        select: { id: true },
      })
      if (!project) return false
    }
    return true
  }
}
