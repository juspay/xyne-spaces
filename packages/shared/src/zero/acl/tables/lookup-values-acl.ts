import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class LookupValuesACL extends BaseQueryACL<'lookup_values'> {
  constructor(ctx: Context) {
    super(ctx, 'lookup_values');
  }

  canSelect<TReturn>(query: Query<'lookup_values', Schema, TReturn>): Query<'lookup_values', Schema, TReturn> {
    // INTENTIONAL global exposure: `lookup_values` is shared reference/enum data
    // with no workspaceId column, so it is not workspace-scoped and the query
    // backstop does not apply. All authenticated users may read it. If this ever
    // becomes tenant-owned data, add a workspace column and scope it here.
    return query;
  }
}
