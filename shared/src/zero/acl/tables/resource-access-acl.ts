import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { AccessType } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ResourceAccessACL extends BaseQueryACL<'resource_access'> {
  constructor(ctx: Context) {
    super(ctx, 'resource_access');
  }

  canSelect<TReturn>(query: Query<'resource_access', Schema, TReturn>): Query<'resource_access', Schema, TReturn> {
    // User Management admins (ADMIN on USERS resource) can see all records
    // Non-admins can only see their own records

    return query.where(({ or, cmp, exists }) =>
      or(
        // Can see own records
        cmp('userId', this.ctx.userID),
        // Or if admin on USERS resource
        exists('resource', (resourceQuery) =>
          resourceQuery
            .where('name', 'USERS')
            .where(({ exists }) =>
              exists('resourceAccess', (accessQuery) =>
                accessQuery
                  .where('userId', this.ctx.userID)
                  .where('accessType', AccessType.ADMIN)
              )
            )
        )
      )
    );
  }
}
