import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RecurringCallParticipantsACL extends BaseQueryACL<
  Prisma.RecurringCallParticipantWhereInput,
  Prisma.RecurringCallParticipantUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RecurringCallParticipantWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.RecurringCallParticipantWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
