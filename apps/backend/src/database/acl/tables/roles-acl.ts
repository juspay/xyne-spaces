import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class RolesACL extends BaseQueryACL<
  Prisma.RoleWhereInput,
  Prisma.RoleUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.RoleWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      isActive: true,
    }
  }

  async getMutateWhere(): Promise<Prisma.RoleWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await this.canManageRoles()) {
      return { workspaceId }
    }
    return { workspaceId, id: { in: [] } }
  }

  async canCreate(data: Prisma.RoleUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    return this.canManageRoles()
  }

  private async canManageRoles(): Promise<boolean> {
    if (this.ctx.role === 'OWNER' || this.ctx.role === 'ADMIN') {
      return true
    }
    const resource = await this.prisma.resource.findUnique({
      where: { name: 'ROLES' },
      select: { id: true },
    })
    if (!resource) return false
    const access = await this.prisma.resourceAccess.findFirst({
      where: {
        userId: this.ctx.userId,
        resourceId: resource.id,
        accessType: { in: ['WRITE', 'ADMIN'] },
      },
      select: { id: true },
    })
    return access !== null
  }
}
