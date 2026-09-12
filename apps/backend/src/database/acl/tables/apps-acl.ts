import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { appVisibilityWhere, resolveOrgId } from './app-scope-helper'

export class AppsACL extends BaseQueryACL<
  Prisma.AppsWhereInput,
  Prisma.AppsUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  /**
   * Apps are org-owned (`orgId` + `scope: 'ORG'`) but carry the creating workspace's id, so
   * workspace scope would hide an org app from every workspace except the one that made it —
   * which is what made a cross-workspace install 404. Reads resolve at org scope instead, plus
   * GLOBAL apps, which are installable from anywhere.
   */
  async getWhereClause(): Promise<Prisma.AppsWhereInput> {
    return appVisibilityWhere(this.prisma, this.ctx.workspaceId)
  }

  /**
   * Writes stay with the creator, but follow them across the org: the app template is edited from
   * wherever its creator is, not only from the workspace the row was stamped with.
   */
  async getMutateWhere(): Promise<Prisma.AppsWhereInput> {
    const orgId = await resolveOrgId(this.prisma, this.ctx.workspaceId)
    if (!orgId) return { workspaceId: this.ctx.workspaceId, createdBy: this.ctx.userId }
    return { orgId, createdBy: this.ctx.userId }
  }

  async canCreate(_data: Prisma.AppsUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
