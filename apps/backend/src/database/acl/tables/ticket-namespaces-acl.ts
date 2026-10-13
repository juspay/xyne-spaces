import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getGuestAccessibleChannelIds, isGuestContext } from './channel-access-helper'

export class TicketNamespacesACL extends BaseQueryACL<
  Prisma.TicketNamespaceWhereInput,
  Prisma.TicketNamespaceUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.TicketNamespaceWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getGuestAccessibleChannelIds(
        this.prisma,
        this.ctx.workspaceId ?? '',
        this.ctx.userId
      )

      // A guest sees a namespace only if its project has an accessible channel.
      return {
        workspaceId: this.ctx.workspaceId ?? '',
        project: {
          channels: {
            some: { id: { in: channelIds } },
          },
        },
      }
    }

    return { workspaceId: this.ctx.workspaceId }
  }

  async getMutateWhere(): Promise<Prisma.TicketNamespaceWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.TicketNamespaceUncheckedCreateInput): Promise<boolean> {
    if (data.workspaceId !== this.ctx.workspaceId) return false
    const project = await this.prisma.project.findFirst({
      where: { id: data.projectId, workspaceId: this.ctx.workspaceId },
      select: { id: true },
    })
    return project !== null
  }
}
