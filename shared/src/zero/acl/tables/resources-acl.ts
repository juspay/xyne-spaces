import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { AccessType } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ResourcesACL extends BaseQueryACL<'resources'> {
  constructor(ctx: Context) {
    super(ctx, 'resources');
  }

  canSelect<TReturn>(query: Query<'resources', Schema, TReturn>): Query<'resources', Schema, TReturn> {
    // User Management admins (ADMIN on USERS resource) can see all resources
    // Non-admins can only see resources they have some access to

    return query.where(({ or, exists }) =>
      or(
        // Can see resources they have access to
        exists('resourceAccess', (accessQuery) =>
          accessQuery.where('userId', this.ctx.userID)
        ),
        // Or if admin on USERS resource (User Management admin)
        exists('resourceAccess', (accessQuery) =>
          accessQuery
            .where('userId', this.ctx.userID)
            .where('accessType', AccessType.ADMIN)
            .where(({ exists }) =>
              exists('resource', (r) => r.where('name', 'USERS'))
            )
        )
      )
    );
  }
}
