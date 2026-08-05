import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class EmailChannelPreferencesACL extends BaseQueryACL<
  Prisma.EmailChannelPreferenceWhereInput,
  Prisma.EmailChannelPreferenceUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.EmailChannelPreferenceWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.EmailChannelPreferenceWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }
}
