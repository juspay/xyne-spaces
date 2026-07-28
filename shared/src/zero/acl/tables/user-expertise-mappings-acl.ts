import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { isGuestContext, guestVisibleUserWhere } from '../core/guest-acl-utils';

export class UserExpertiseMappingsACL extends BaseQueryACL<'user_expertise_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_expertise_mappings');
  }

  canSelect<TReturn>(
    query: Query<'user_expertise_mappings', Schema, TReturn>,
  ): Query<'user_expertise_mappings', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('user', (u) =>
        u.where('workspaceId', '=', this.ctx.workspaceId).where(guestVisibleUserWhere(this.ctx)),
      );
    }

    return query.whereExists('userGroup', (ug) => ug.where('workspaceId', '=', this.ctx.workspaceId));
  }
}
