import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { isGuestContext, guestVisibleUserWhere } from '../core/guest-acl-utils';

export class UserGroupMappingsACL extends BaseQueryACL<'user_group_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_group_mappings');
  }

  canSelect<TReturn>(query: Query<'user_group_mappings', Schema, TReturn>): Query<'user_group_mappings', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('user', (u) =>
        u.where('workspaceId', '=', this.ctx.workspaceId).where(guestVisibleUserWhere(this.ctx)),
      );
    }

    return query.whereExists('userGroup', (ug) => ug.where('workspaceId', '=', this.ctx.workspaceId));
  }
}
