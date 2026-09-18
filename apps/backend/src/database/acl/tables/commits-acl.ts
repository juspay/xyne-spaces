import { PrismaClient, Prisma } from '@prisma/client';
import { BaseQueryACL, ACLContext } from '../base-acl';

/**
 * ACL for Commit table - scoped via denormalized workspaceId
 */
export class CommitsACL extends BaseQueryACL<
  Prisma.CommitWhereInput,
  Prisma.CommitUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  /**
   * Filter commits by workspace using denormalized workspaceId
   */
  async getWhereClause(): Promise<Prisma.CommitWhereInput> {
    return {
      workspaceId: this.ctx.workspaceId,
    };
  }

  /**
   * Commits are server-written only - block all mutations
   */
  async canCreate(_data: Prisma.CommitUncheckedCreateInput): Promise<boolean> {
    return false; // Commits are synced from VCS only
  }
}
