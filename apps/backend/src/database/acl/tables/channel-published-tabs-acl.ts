import { Prisma, PrismaClient } from '@prisma/client';
import { ACLContext, BaseQueryACL } from '../base-acl';

/**
 * Prisma-side tenant scoping for channel_published_tabs. Who may publish or
 * unpublish is decided by the Zero ACL (zero/acl/tables/channel-published-tabs-acl.ts);
 * this only keeps any backend Prisma access inside the caller's workspace.
 */
export class ChannelPublishedTabsACL extends BaseQueryACL<
  Prisma.ChannelPublishedTabWhereInput,
  Prisma.ChannelPublishedTabUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  async getWhereClause(): Promise<Prisma.ChannelPublishedTabWhereInput> {
    return { workspaceId: this.ctx.workspaceId };
  }

  async getMutateWhere(): Promise<Prisma.ChannelPublishedTabWhereInput> {
    return { workspaceId: this.ctx.workspaceId };
  }

  async canCreate(data: Prisma.ChannelPublishedTabUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId;
  }
}
