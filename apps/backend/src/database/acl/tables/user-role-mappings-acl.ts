import { Prisma, PrismaClient, AccessType } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class UserRoleMappingsACL extends BaseQueryACL<
  Prisma.UserRoleMappingWhereInput,
  Prisma.UserRoleMappingUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.UserRoleMappingWhereInput> {
    return {
      role: {
        workspaceId: this.ctx.workspaceId,
        isActive: true,
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.UserRoleMappingWhereInput> {
    const workspaceId = this.ctx.workspaceId
    if (await this.canManageRoles()) {
      return { workspaceId }
    }
    return { workspaceId, id: { in: [] } }
  }

  async canCreate(data: Prisma.UserRoleMappingUncheckedCreateInput): Promise<boolean> {
    const role = await this.prisma.role.findFirst({
      where: { id: data.roleId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    if (!role) return false
    return this.canManageRoles()
  }

  private async canManageRoles(): Promise<boolean> {
    if (this.ctx.role === 'OWNER' || this.ctx.role === 'ADMIN') return true
    const rolesResource = await this.prisma.resource.findUnique({
      where: { name: 'ROLES' },
      select: { id: true },
    })
    if (!rolesResource) return false
    const access = await this.prisma.resourceAccess.findFirst({
      where: {
        userId: this.ctx.userId,
        resourceId: rolesResource.id,
        accessType: { in: [AccessType.WRITE, AccessType.ADMIN] },
      },
      select: { id: true },
    })
    return access !== null
  }
}
