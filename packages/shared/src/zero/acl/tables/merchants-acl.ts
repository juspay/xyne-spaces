import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class MerchantsACL extends BaseQueryACL<'merchants'> {
  constructor(ctx: Context) {
    super(ctx, 'merchants');
  }

  canSelect<TReturn>(query: Query<'merchants', Schema, TReturn>): Query<'merchants', Schema, TReturn> {
    // INTENTIONAL global exposure: `merchants` is a cross-tenant reference catalog
    // with no workspaceId column, so it is not workspace-scoped and the query
    // backstop does not apply. All authenticated users may read it. If this ever
    // becomes tenant-owned data, add a workspace/org column and scope it here.
    return query;
  }
}
