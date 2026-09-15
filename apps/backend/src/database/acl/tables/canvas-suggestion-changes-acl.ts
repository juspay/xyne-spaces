import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasSuggestionChangesACL extends BaseQueryACL<
  Prisma.CanvasSuggestionChangeWhereInput,
  Prisma.CanvasSuggestionChangeUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasSuggestionChangeWhereInput> {
      return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.CanvasSuggestionChangeWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.CanvasSuggestionChangeUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
