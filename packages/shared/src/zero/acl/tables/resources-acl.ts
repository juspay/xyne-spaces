import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ResourcesACL extends BaseQueryACL<'resources'> {
  constructor(ctx: Context) {
    super(ctx, 'resources');
  }

  canSelect<TReturn>(query: Query<'resources', Schema, TReturn>): Query<'resources', Schema, TReturn> {
    return query;
  }
}
