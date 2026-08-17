import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class ProjectsACL extends BaseQueryACL<
  Prisma.ProjectWhereInput,
  Prisma.ProjectUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.ProjectWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      return {
        workspaceId: this.ctx.workspaceId ?? '',
        channels: {
          some: {
            id: { in: channelIds },
          },
        },
      }
    }

    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.ProjectWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(_data: Prisma.ProjectUncheckedCreateInput): Promise<boolean> {
    return true
  }
}
