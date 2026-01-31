import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserWorkloadMappingsACL extends BaseQueryACL<'user_workload_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_workload_mappings');
  }

  canSelect<TReturn>(
    query: Query<'user_workload_mappings', Schema, TReturn>,
  ): Query<'user_workload_mappings', Schema, TReturn> {
    // Users can only see workload data for groups they belong to
    return query.whereExists('userGroup', (userGroupQuery) => {
      return userGroupQuery.whereExists('userGroupMappings', (mappingQuery) => {
        return mappingQuery.where('userId', this.ctx.userID);
      });
    });
  }
}
