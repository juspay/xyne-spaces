import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class StageTransitionsACL extends BaseQueryACL<
  Prisma.StageTransitionWhereInput,
  Prisma.StageTransitionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.StageTransitionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.StageTransitionWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
