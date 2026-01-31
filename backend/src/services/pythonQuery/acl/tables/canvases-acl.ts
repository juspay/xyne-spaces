import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class CanvasesACL extends BaseQueryACL<Prisma.CanvasWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.CanvasWhereInput> {
    // Get canvas IDs where user is a participant
    const participantCanvases = await this.prisma.canvasParticipant.findMany({
      where: { userId: this.ctx.userId },
      select: { canvasId: true },
    })

    const participantCanvasIds = participantCanvases.map((p) => p.canvasId)

    return {
      OR: [
        { visibility: 'PUBLIC' },
        { createdBy: this.ctx.userId },
        { id: { in: participantCanvasIds } },
      ],
    }
  }
}
