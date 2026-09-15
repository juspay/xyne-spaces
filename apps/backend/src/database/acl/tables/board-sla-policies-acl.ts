import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class BoardSlaPoliciesACL extends BaseQueryACL<
  Prisma.BoardSlaPolicyWhereInput,
  Prisma.BoardSlaPolicyUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.BoardSlaPolicyWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.BoardSlaPolicyWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
