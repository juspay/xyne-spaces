import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class EmailReadsACL extends BaseQueryACL<
  Prisma.EmailReadWhereInput,
  Prisma.EmailReadUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.EmailReadWhereInput> {
    return {
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.EmailReadWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId }
  }

  async canCreate(data: Prisma.EmailReadUncheckedCreateInput): Promise<boolean> {
    return data.userId === this.ctx.userId
  }
}
