import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class GlobalFieldsACL extends BaseQueryACL<'global_fields'> {
  constructor(ctx: Context) {
    super(ctx, 'global_fields');
  }

  canSelect<TReturn>(
    query: Query<'global_fields', Schema, TReturn>
  ): Query<'global_fields', Schema, TReturn> {
    // Definitions are project-scoped; project.workspaceId keeps workspace isolation.
    return query.whereExists('project', projectQuery =>
      projectQuery.where('workspaceId', '=', this.ctx.workspaceId),
    );
  }
}
