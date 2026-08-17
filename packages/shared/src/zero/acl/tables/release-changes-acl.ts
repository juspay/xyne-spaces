import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReleaseChangesACL extends BaseQueryACL<'release_changes'> {
  constructor(ctx: Context) {
    super(ctx, 'release_changes');
  }

  canSelect<TReturn>(query: Query<'release_changes', Schema, TReturn>): Query<'release_changes', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
