import { PrismaClient, Prisma } from '@prisma/client';
import { BaseQueryACL, ACLContext } from '../base-acl';

/**
 * ACL for Commit table - scoped via pull_requests.workspaceId relationship
 *
 * Commits don't have a direct workspaceId field (denormalized away for storage efficiency)
 * but are scoped via the pullRequest FK relationship which has workspaceId.
 */
export class CommitsACL extends BaseQueryACL<
  Prisma.CommitWhereInput,
  Prisma.CommitUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  /**
   * Filter commits by workspace through the pullRequest relationship
   */
  async getWhereClause(): Promise<Prisma.CommitWhereInput> {
    return {
      pullRequest: {
        workspaceId: this.ctx.workspaceId,
      },
    };
  }

  /**
   * Commits are server-written only - block all mutations
   */
  async canCreate(_data: Prisma.CommitUncheckedCreateInput): Promise<boolean> {
    return false; // Commits are synced from VCS only
  }
}
