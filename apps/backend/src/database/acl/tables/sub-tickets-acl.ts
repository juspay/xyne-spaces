import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

export class SubTicketsACL extends BaseQueryACL<
  Prisma.SubTicketWhereInput,
  Prisma.SubTicketUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.SubTicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    }
  }

  async getMutateWhere(): Promise<Prisma.SubTicketWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
      OR: [
        { mappedTicketId: null },
        {
          mappedTicket: {
            channel: {
              OR: [
                {
                  visibility: 'PRIVATE',
                  participants: { some: { userId: this.ctx.userId } },
                },
                {
                  visibility: 'PUBLIC',
                  project: {
                    channels: {
                      some: {
                        visibility: 'PUBLIC',
                        participants: { some: { userId: this.ctx.userId } },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    }
  }

  async canCreate(data: Prisma.SubTicketUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
