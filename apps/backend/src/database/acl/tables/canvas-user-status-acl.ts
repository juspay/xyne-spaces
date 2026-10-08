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

  async getWhereClause(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasUserStatusWhereInput> {
    // Slack Connect: single-entity gate on the query's connectId/canvasId; else workspaceId.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_user_status', 'read', {
      connectId: queryWhere?.canvasConnectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
  }

  async getMutateWhere(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasUserStatusWhereInput> {
    // Slack Connect: update/delete scope follows the same single-entity gate as reads.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_user_status', 'write', {
      connectId: queryWhere?.canvasConnectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
  }
}
