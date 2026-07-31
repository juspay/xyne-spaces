import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class LinksACL extends BaseQueryACL<
  Prisma.LinkWhereInput,
  Prisma.LinkUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.LinkWhereInput> {
    // Scope via channel.workspaceId (Channel has denormalized workspaceId).
    const channels = await this.prisma.channel.findMany({
      where: { workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return { channelId: { in: channels.map((c) => c.id) } }
  }

  async getMutateWhere(): Promise<Prisma.LinkWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.LinkUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
