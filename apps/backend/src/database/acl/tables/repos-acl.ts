import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReposACL extends BaseQueryACL<
  Prisma.RepoWhereInput,
  Prisma.RepoUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RepoWhereInput | null> {
    // No table-specific read rule; the extension applies the workspace default.
    return null
  }

  async getMutateWhere(): Promise<Prisma.RepoWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.RepoUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
