import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserAssignmentStatesACL extends BaseQueryACL<'user_assignment_states'> {
  constructor(ctx: Context) {
    super(ctx, 'user_assignment_states');
  }

  canSelect<TReturn>(
    query: Query<'user_assignment_states', Schema, TReturn>,
  ): Query<'user_assignment_states', Schema, TReturn> {
    // Users can only see assignment states for groups they belong to
    return query.whereExists('userGroup', (userGroupQuery) => {
      return userGroupQuery.whereExists('userGroupMappings', (mappingQuery) => {
        return mappingQuery.where('userId', this.ctx.userID);
      });
    });
  }
}
