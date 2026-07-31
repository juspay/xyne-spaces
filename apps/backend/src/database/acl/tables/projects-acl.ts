import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { hasProjectAdminAccess } from '../admin-access'
import { getGuestAccessibleProjectIds, isGuestContext } from './channel-access-helper'

export class ProjectsACL extends BaseQueryACL<
  Prisma.ProjectWhereInput,
  Prisma.ProjectUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ProjectWhereInput> {
    if (isGuestContext(this.ctx)) {
      const projectIds = await getGuestAccessibleProjectIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        id: { in: projectIds },
      }
    }

    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.ProjectWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await hasProjectAdminAccess(this.prisma, this.ctx.userId)) {
      return { workspaceId }
    }
    return { workspaceId, createdBy: this.ctx.userId }
  }

  async canCreate(data: Prisma.ProjectUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    return hasProjectAdminAccess(this.prisma, this.ctx.userId)
  }
}
