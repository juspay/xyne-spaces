import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

/**
 * ACL for Saved Views (parent config rows).
 *
 * A user may read a Saved View if, within their own workspace, they own it OR
 * it is shared PUBLIC. The row carries its own denormalized workspaceId, which
 * enforces the workspace boundary directly and keeps PUBLIC views from other
 * workspaces from being read cross-tenant.
 */
export class SavedUserConfigurationsACL extends BaseQueryACL<
  Prisma.SavedUserConfigurationWhereInput,
  Prisma.SavedUserConfigurationUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SavedUserConfigurationWhereInput> {
    // Fail closed: without a workspace we only ever expose the caller's own views.
    if (!this.ctx.workspaceId) {
      return { userId: this.ctx.userId }
    }

    return {
      // Hard workspace boundary: the row carries its own denormalized workspaceId.
      workspaceId: this.ctx.workspaceId,
      // Within the workspace: your own views, plus PUBLIC (shared) views.
      OR: [{ userId: this.ctx.userId }, { visibility: 'PUBLIC' }],
    }
  }

  async getMutateWhere(): Promise<Prisma.SavedUserConfigurationWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      userId: this.ctx.userId,
    }
  }

  async canCreate(data: Prisma.SavedUserConfigurationUncheckedCreateInput): Promise<boolean> {
    if (data.userId !== this.ctx.userId) return false
    if (data.workspaceId !== this.ctx.workspaceId) return false
    if (data.visibility === 'PUBLIC') {
      return this.canMakePublicView(data.contextId)
    }
    return true
  }

  private async canMakePublicView(boardId: string): Promise<boolean> {
    const board = await this.prisma.board.findFirst({
      where: { id: boardId },
      select: { createdBy: true, projectId: true },
    })
    if (!board) return false
    if (board.createdBy === this.ctx.userId) return true

    const project = await this.prisma.project.findFirst({
      where: { id: board.projectId },
      select: { id: true, createdBy: true },
    })
    if (!project) return false
    if (project.createdBy === this.ctx.userId) return true

    const adminParticipant = await this.prisma.channelParticipant.findFirst({
      where: {
        userId: this.ctx.userId,
        role: 'ADMIN',
        channel: { projectId: project.id },
      },
      select: { id: true },
    })
    return adminParticipant !== null
  }
}
