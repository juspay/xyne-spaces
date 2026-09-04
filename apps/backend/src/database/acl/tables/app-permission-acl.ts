import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { appVisibilityWhere } from './app-scope-helper'

/**
 * The permission grants on an app template. Same rule as AppCommandACL: visibility follows the
 * parent app's org scope, so `copyFromApp` can read the grants when installing an app another
 * workspace in the org created.
 */
export class AppPermissionACL extends BaseQueryACL<
  Prisma.AppPermissionWhereInput,
  Prisma.AppPermissionUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.AppPermissionWhereInput> {
    return { app: { is: await appVisibilityWhere(this.prisma, this.ctx.workspaceId) } }
  }

  async getMutateWhere(): Promise<Prisma.AppPermissionWhereInput> {
    return {
      app: {
        is: {
          AND: [
            await appVisibilityWhere(this.prisma, this.ctx.workspaceId),
            { createdBy: this.ctx.userId },
          ],
        },
      },
    }
  }
}
