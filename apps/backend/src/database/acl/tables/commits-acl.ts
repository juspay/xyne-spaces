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
   * Allow creates when workspaceId matches context
   */
  async canCreate(data: Prisma.CommitUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId;
  }
}
