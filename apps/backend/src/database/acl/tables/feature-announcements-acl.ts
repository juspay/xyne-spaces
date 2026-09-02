import { Prisma, PrismaClient } from '@prisma/client';
import { BaseQueryACL, ACLContext } from '../base-acl';

/**
 * Announcement content spans workspaces: a null workspaceId means "every workspace".
 * The default workspace-equality clause would drop exactly those rows, so both reads and
 * writes have to spell the disjunction out.
 */
export class FeatureAnnouncementsACL extends BaseQueryACL<
  Prisma.FeatureAnnouncementWhereInput,
  Prisma.FeatureAnnouncementUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  async getWhereClause(): Promise<Prisma.FeatureAnnouncementWhereInput> {
    return {
      OR: [{ workspaceId: null }, { workspaceId: this.ctx.workspaceId }],
    };
  }

  /**
   * Writes are narrower than reads. An admin authors within their own workspace; a
   * product-wide row is created out-of-band and is not editable through the API, because
   * this backend has no cross-workspace admin role to authorise that.
   */
  async getMutateWhere(): Promise<Prisma.FeatureAnnouncementWhereInput> {
    return { workspaceId: this.ctx.workspaceId };
  }

  async canCreate(data: Prisma.FeatureAnnouncementUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId;
  }
}

/** Per-user surface state is only ever the caller's own. */
export class UserSurfaceStatesACL extends BaseQueryACL<
  Prisma.UserSurfaceStateWhereInput,
  Prisma.UserSurfaceStateUncheckedCreateInput
> {
  constructor(ctx: ACLContext, prisma: PrismaClient) {
    super(ctx, prisma);
  }

  async getWhereClause(): Promise<Prisma.UserSurfaceStateWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId };
  }

  async getMutateWhere(): Promise<Prisma.UserSurfaceStateWhereInput> {
    return { workspaceId: this.ctx.workspaceId, userId: this.ctx.userId };
  }

  async canCreate(data: Prisma.UserSurfaceStateUncheckedCreateInput): Promise<boolean> {
    return data.workspaceId === this.ctx.workspaceId && data.userId === this.ctx.userId;
  }
}
