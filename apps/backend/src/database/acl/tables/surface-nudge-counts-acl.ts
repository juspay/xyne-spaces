import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SurfaceNudgeCountsACL extends BaseQueryACL<
  Prisma.SurfaceNudgeCountWhereInput,
  Prisma.SurfaceNudgeCountUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — aggregate counts read from any workspace.
  async getWhereClause(): Promise<Prisma.SurfaceNudgeCountWhereInput | null> {
    return null
  }

  async getMutateWhere(): Promise<Prisma.SurfaceNudgeCountWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.SurfaceNudgeCountUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
