import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class ProactiveNudgesACL extends BaseQueryACL<
  Prisma.ProactiveNudgeWhereInput,
  Prisma.ProactiveNudgeUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ProactiveNudgeWhereInput> {
    // The row carries its own denormalized workspaceId, so scope on it directly. Walking
    // conversation → message to build an id list would load every message in the workspace
    // into memory on each read.
    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.ProactiveNudgeWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(_data: Prisma.ProactiveNudgeUncheckedCreateInput): Promise<boolean> {
    return false
  }
}
