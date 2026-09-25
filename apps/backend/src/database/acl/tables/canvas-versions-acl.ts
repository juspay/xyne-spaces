import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { connectReachWhere } from '../../connectGroup'

export class CanvasVersionsACL extends BaseQueryACL<
  Prisma.CanvasVersionWhereInput,
  Prisma.CanvasVersionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasVersionWhereInput> {
      // Slack Connect: connectId → connect_group workspace truth; else workspaceId.
      return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_versions')
  }

  async getMutateWhere(): Promise<Prisma.CanvasVersionWhereInput> {
    // Slack Connect: update/delete scope follows the same connect_group reach as reads.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_versions', 'write')
  }

  async canCreate(data: Prisma.CanvasVersionUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
