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

    return query
      .where('status', '=', Status.ACTIVE)
      .whereExists('orgMembers', (om) =>
        om.where('memberId', '=', this.ctx.memberId)
      );
  }
}
