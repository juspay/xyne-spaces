import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ProjectTagsACL extends BaseQueryACL<
  Prisma.ProjectTagWhereInput,
  Prisma.ProjectTagUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ProjectTagWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ProjectTagWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
