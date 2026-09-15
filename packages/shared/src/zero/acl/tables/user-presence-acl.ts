import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserPresenceACL extends BaseQueryACL<'user_presence'> {
  constructor(ctx: Context) {
    super(ctx, 'user_presence');
  }

  canSelect<TReturn>(query: Query<'user_presence', Schema, TReturn>): Query<'user_presence', Schema, TReturn> {
    // Presence is a see-everyone feature (teammate online/away/status dots), so
    // scope only to the workspace — not to the caller's own row.
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
