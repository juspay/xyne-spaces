import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReleaseChangeTypesACL extends BaseQueryACL<'release_change_types'> {
  constructor(ctx: Context) {
    super(ctx, 'release_change_types');
  }

  canSelect<TReturn>(query: Query<'release_change_types', Schema, TReturn>): Query<'release_change_types', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
