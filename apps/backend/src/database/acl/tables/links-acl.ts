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
      return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.LinkWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.LinkUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
