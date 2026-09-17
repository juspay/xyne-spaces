import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class MerchantsACL extends BaseQueryACL<'merchants'> {
  constructor(ctx: Context) {
    super(ctx, 'merchants');
  }

  canSelect<TReturn>(query: Query<'merchants', Schema, TReturn>): Query<'merchants', Schema, TReturn> {
    // Shared reference catalog, readable by all authenticated users. If this ever
    // becomes tenant-owned, add a workspace/org column and scope it here.
    return query;
  }
}
