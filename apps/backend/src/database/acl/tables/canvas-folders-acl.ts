import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasFoldersACL extends BaseQueryACL<
  Prisma.CanvasFolderWhereInput,
  Prisma.CanvasFolderUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasFolderWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.CanvasFolderWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
