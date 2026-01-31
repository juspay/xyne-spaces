import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserExpertiseMappingsACL extends BaseQueryACL<'user_expertise_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_expertise_mappings');
  }

  canSelect<TReturn>(
    query: Query<'user_expertise_mappings', Schema, TReturn>,
  ): Query<'user_expertise_mappings', Schema, TReturn> {
    // Users can only see expertise mappings for groups they belong to
    return query.whereExists('userGroup', (userGroupQuery) => {
      return userGroupQuery.whereExists('userGroupMappings', (mappingQuery) => {
        return mappingQuery.where('userId', this.ctx.userID);
      });
    });
  }
}
