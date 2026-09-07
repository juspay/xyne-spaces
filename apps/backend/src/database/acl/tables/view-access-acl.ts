import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ViewAccessACL extends BaseQueryACL<
  Prisma.ViewAccessWhereInput,
  Prisma.ViewAccessUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ViewAccessWhereInput> {
    return {
      OR: [
        { entityType: 'USER', entityId: this.ctx.userId },
        { sharedBy: this.ctx.userId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.ViewAccessWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { entityType: 'USER', entityId: this.ctx.userId },
        { sharedBy: this.ctx.userId },
      ],
    }
  }

  async canCreate(data: Prisma.ViewAccessUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
