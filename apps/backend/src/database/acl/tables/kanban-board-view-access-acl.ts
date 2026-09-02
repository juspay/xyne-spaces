import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class KanbanBoardViewAccessACL extends BaseQueryACL<
  Prisma.KanbanBoardViewAccessWhereInput,
  Prisma.KanbanBoardViewAccessUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.KanbanBoardViewAccessWhereInput> {
    return {
      OR: [
        { userId: this.ctx.userId },
        { sharedBy: this.ctx.userId },
      ],
    }
  }

  async getMutateWhere(): Promise<Prisma.KanbanBoardViewAccessWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { userId: this.ctx.userId },
        { sharedBy: this.ctx.userId },
      ],
    }
  }

  async canCreate(data: Prisma.KanbanBoardViewAccessUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
