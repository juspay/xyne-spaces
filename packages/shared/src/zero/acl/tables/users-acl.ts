import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestVisibleUserWhere, isGuestContext } from '../core/guest-acl-utils';

export class UsersACL extends BaseQueryACL<'users'> {
  constructor(ctx: Context) {
    super(ctx, 'users');
  }

  canSelect<TReturn>(query: Query<'users', Schema, TReturn>): Query<'users', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      // Themselves, plus people in a channel or on a canvas the guest can access.
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(guestVisibleUserWhere(this.ctx));
    }

    // All users are visible to authenticated users within the same workspace
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
