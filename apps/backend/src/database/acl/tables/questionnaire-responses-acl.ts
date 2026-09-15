import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class QuestionnaireResponsesACL extends BaseQueryACL<
  Prisma.QuestionnaireResponseWhereInput,
  Prisma.QuestionnaireResponseUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.QuestionnaireResponseWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async getMutateWhere(): Promise<Prisma.QuestionnaireResponseWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async canCreate(data: Prisma.QuestionnaireResponseUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId && data.userId === this.ctx.userId
  }
}
