import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { Status } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class WorkspacesACL extends BaseQueryACL<'workspaces'> {
  constructor(ctx: Context) {
    super(ctx, 'workspaces');
  }

  canSelect<TReturn>(query: Query<'workspaces', Schema, TReturn>): Query<'workspaces', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    // The caller's own workspace is always readable, even when their org_members row
    // belongs to a different org than the one owning the workspace (cross-org members
    // joined via users, e.g. external collaborators). Mirrors the Prisma WorkspacesACL.
    return query
      .where('status', '=', Status.ACTIVE)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('id', '=', this.ctx.workspaceId),
          exists('orgMembers', (om) => om.where('memberId', '=', this.ctx.memberId)),
        ),
      );
  }
}
