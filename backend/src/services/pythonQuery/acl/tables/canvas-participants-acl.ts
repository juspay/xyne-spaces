import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasParticipantsACL extends BaseQueryACL<Prisma.CanvasParticipantWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasParticipantWhereInput | null> {
    // Get canvases user has access to (created by user, public, or user is participant)
    const accessibleCanvases = await this.prisma.canvas.findMany({
      where: {
        OR: [
          { createdBy: this.ctx.userId },
          { visibility: 'PUBLIC' },
        ],
      },
      select: { id: true },
    })

    // Also get canvases where user is a participant
    const participantCanvases = await this.prisma.canvasParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { canvasId: true },
    })

    const accessibleCanvasIds = [
      ...new Set([
        ...accessibleCanvases.map((c) => c.id),
        ...participantCanvases.map((p) => p.canvasId),
      ]),
    ]

    return {
      OR: [
        { userId: this.ctx.userId },
        { canvasId: { in: accessibleCanvasIds } },
      ],
    }
  }
}
