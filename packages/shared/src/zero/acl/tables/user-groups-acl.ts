import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { isGuestContext, guestVisibleUserWhere } from '../core/guest-acl-utils';

export class UserGroupsACL extends BaseQueryACL<'user_groups'> {
  constructor(ctx: Context) {
    super(ctx, 'user_groups');
  }

  canSelect<TReturn>(query: Query<'user_groups', Schema, TReturn>): Query<'user_groups', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('userGroupMappings', (ugm) =>
          ugm.whereExists('user', (u) => u.where(guestVisibleUserWhere(this.ctx))),
        );
    }

    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
