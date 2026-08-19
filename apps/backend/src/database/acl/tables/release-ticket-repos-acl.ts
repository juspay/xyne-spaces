import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ReleaseTicketReposACL extends BaseQueryACL<
  Prisma.ReleaseTicketRepoWhereInput,
  Prisma.ReleaseTicketRepoUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ReleaseTicketRepoWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.ReleaseTicketRepoWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.ReleaseTicketRepoUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
