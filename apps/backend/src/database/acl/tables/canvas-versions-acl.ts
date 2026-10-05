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

  async getWhereClause(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasVersionWhereInput> {
      // Slack Connect: single-entity gate on the query's connectId/canvasId; else workspaceId.
      return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_versions', 'read', {
        connectId: queryWhere?.connectId as string | undefined,
        canvasId: queryWhere?.canvasId as string | undefined,
      })
  }

  async getMutateWhere(queryWhere?: Record<string, unknown>): Promise<Prisma.CanvasVersionWhereInput> {
    // Slack Connect: update/delete scope follows the same single-entity gate as reads.
    return connectReachWhere(this.prisma, this.ctx.workspaceId, 'canvas_versions', 'write', {
      connectId: queryWhere?.connectId as string | undefined,
      canvasId: queryWhere?.canvasId as string | undefined,
    })
  }

  async canCreate(data: Prisma.CanvasVersionUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
