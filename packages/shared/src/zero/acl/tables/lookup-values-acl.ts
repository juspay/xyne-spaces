import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class LookupValuesACL extends BaseQueryACL<'lookup_values'> {
  constructor(ctx: Context) {
    super(ctx, 'lookup_values');
  }

  canSelect<TReturn>(query: Query<'lookup_values', Schema, TReturn>): Query<'lookup_values', Schema, TReturn> {
    // Shared reference/enum data, readable by all authenticated users. If this ever
    // becomes tenant-owned, add a workspace column and scope it here.
    return query;
  }
}
