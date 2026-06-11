import { Prisma, PrismaClient } from '@prisma/client'
import { BaseQueryACL, ACLContext } from '../base-acl'

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
export class EmailsACL extends BaseQueryACL<Prisma.EmailWhereInput> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma)
  }

  async getWhereClause(): Promise<Prisma.EmailWhereInput> {
    return {
      channel: {
        AND: [
          { workspaceId: this.ctx.workspaceId ?? '' },
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
}
