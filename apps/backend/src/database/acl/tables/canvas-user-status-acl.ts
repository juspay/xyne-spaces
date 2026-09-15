import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasUserStatusACL extends BaseQueryACL<
  Prisma.CanvasUserStatusWhereInput,
  Prisma.CanvasUserStatusUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasUserStatusWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasUserStatusWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
