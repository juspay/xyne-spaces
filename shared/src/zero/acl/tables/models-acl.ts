import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ModelsACL extends BaseQueryACL<'models'> {
  constructor(ctx: Context) {
    super(ctx, 'models');
  }

  canSelect<TReturn>(query: Query<'models', Schema, TReturn>): Query<'models', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
