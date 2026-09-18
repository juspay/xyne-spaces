import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { connectReachWhere } from '../../connectGroup'

export class CanvasUserStatusACL extends BaseQueryACL<
  Prisma.CanvasUserStatusWhereInput,
  Prisma.CanvasUserStatusUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasUserStatusWhereInput> {
    // Slack Connect: connectId → connect_group workspace truth; else workspaceId.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_user_status')
  }

  async getMutateWhere(): Promise<Prisma.CanvasUserStatusWhereInput> {
    // Slack Connect: update/delete scope follows the same connect_group reach as reads.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_user_status', 'write')
  }
}
