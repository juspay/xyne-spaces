import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'
import { getAccessibleChannelIds, isGuestContext } from './channel-access-helper'

/**
 * ACL for the `email` model.
 *
 * Scopes rows to channels the caller can access — same predicate as
 * ChannelsACL (PUBLIC or participant, in the caller's workspace) — via the
 * emulated `channel` relation (relationMode="prisma", no DB FK).
 *
 * Without this, /api/query on `email` fell through to BaseQueryACL (no filter),
 * letting any authenticated user read private email channels by id.
 */
export class EmailsACL extends BaseQueryACL<
  Prisma.EmailWhereInput,
  Prisma.EmailUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.EmailWhereInput> {
    if (isGuestContext(this.ctx)) {
      const channelIds = await getAccessibleChannelIds(this.prisma, this.ctx.userId, this.ctx)

      return {
        channel: {
          workspaceId: this.ctx.workspaceId ?? '',
          id: { in: channelIds },
        },
      }
    }

    return {
      channel: {
        AND: [
          { workspaceId: this.ctx.workspaceId },
          {
            OR: [
              { visibility: 'PUBLIC' },
              { participants: { some: { userId: this.ctx.userId } } },
            ],
          },
        ],
      },
    }
  }

  async getMutateWhere(): Promise<Prisma.EmailWhereInput> {
    return { workspaceId: this.ctx.workspaceId }
  }

  async canCreate(data: Prisma.EmailUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId
  }
}
