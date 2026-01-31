import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserGroupsACL extends BaseQueryACL<'user_groups'> {
  constructor(ctx: Context) {
    super(ctx, 'user_groups');
  }

  canSelect<TReturn>(query: Query<'user_groups', Schema, TReturn>): Query<'user_groups', Schema, TReturn> {
    return query;
  }
}
