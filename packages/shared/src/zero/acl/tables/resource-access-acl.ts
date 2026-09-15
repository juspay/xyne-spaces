import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ResourceAccessACL extends BaseQueryACL<'resource_access'> {
  constructor(ctx: Context) {
    super(ctx, 'resource_access');
  }

  canSelect<TReturn>(query: Query<'resource_access', Schema, TReturn>): Query<'resource_access', Schema, TReturn> {
    if (this.ctx.role === WorkspaceRole.ADMIN || this.ctx.role === WorkspaceRole.OWNER) {
      return query;
    }

    return query.whereExists('resource', (resourceQuery) =>
      resourceQuery.whereExists('resourceAccess', (accessQuery) =>
        accessQuery.where('userId', this.ctx.userID),
      ),
    );
  }
}
