import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class EmailSignaturesACL extends BaseQueryACL<
  Prisma.EmailSignatureWhereInput,
  Prisma.EmailSignatureUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.EmailSignatureWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.EmailSignatureWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
