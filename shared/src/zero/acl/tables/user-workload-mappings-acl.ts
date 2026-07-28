import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { isGuestContext, guestVisibleUserWhere } from '../core/guest-acl-utils';

export class UserWorkloadMappingsACL extends BaseQueryACL<'user_workload_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_workload_mappings');
  }

  canSelect<TReturn>(
    query: Query<'user_workload_mappings', Schema, TReturn>,
  ): Query<'user_workload_mappings', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('user', (u) =>
        u.where('workspaceId', '=', this.ctx.workspaceId).where(guestVisibleUserWhere(this.ctx)),
      );
    }

    // Users can only see workload data for groups they belong to within their workspace
    return query.whereExists('userGroup', (userGroupQuery) => {
      return userGroupQuery
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('userGroupMappings', (mappingQuery) => {
          return mappingQuery.where('userId', this.ctx.userID);
        });
    });
  }
}
