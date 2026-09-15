import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ConversationLabelsACL extends BaseQueryACL<
  Prisma.ConversationLabelWhereInput,
  Prisma.ConversationLabelUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationLabelWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ConversationLabelWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
