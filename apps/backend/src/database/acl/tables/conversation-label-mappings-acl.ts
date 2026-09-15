import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ConversationLabelMappingsACL extends BaseQueryACL<
  Prisma.ConversationLabelMappingWhereInput,
  Prisma.ConversationLabelMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ConversationLabelMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.ConversationLabelMappingWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
