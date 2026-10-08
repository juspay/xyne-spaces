import { Prisma, PrismaClient } from '@prisma/client';
import { ACLContext, BaseQueryACL } from '../base-acl';

/**
 * Prisma-side tenant scoping for channel_published_apps. Who may publish or
 * unpublish is decided by the Zero ACL (zero/acl/tables/channel-published-apps-acl.ts);
 * this only keeps any backend Prisma access inside the caller's workspace.
 */
export class ChannelPublishedAppsACL extends BaseQueryACL<
  Prisma.ChannelPublishedAppWhereInput,
  Prisma.ChannelPublishedAppUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  async getWhereClause(): Promise<Prisma.ChannelPublishedAppWhereInput> {
    return { workspaceId: this.ctx.workspaceId };
  }

  async getMutateWhere(): Promise<Prisma.ChannelPublishedAppWhereInput> {
    return { workspaceId: this.ctx.workspaceId };
  }

  async canCreate(data: Prisma.ChannelPublishedAppUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId;
  }
}
