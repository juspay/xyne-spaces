import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SurfaceNudgeCountsACL extends BaseQueryACL<Prisma.SurfaceNudgeCountWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  // Intentionally global — aggregate counts read from any workspace.
  async getWhereClause(): Promise<Prisma.SurfaceNudgeCountWhereInput | null> {
    return null
  }
}
