import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class StageApproversACL extends BaseQueryACL<
  Prisma.StageApproversWhereInput,
  Prisma.StageApproversUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // No table-specific read rule; the extension applies the workspace default.
  async getWhereClause(): Promise<Prisma.StageApproversWhereInput | null> {
    return null
  }

  async getMutateWhere(): Promise<Prisma.StageApproversWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.StageApproversUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
