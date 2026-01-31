import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserGroupMappingsACL extends BaseQueryACL<'user_group_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_group_mappings');
  }

  canSelect<TReturn>(query: Query<'user_group_mappings', Schema, TReturn>): Query<'user_group_mappings', Schema, TReturn> {
    return query;
  }
}
