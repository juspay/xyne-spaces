import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasVersionsACL extends BaseQueryACL<'canvas_versions'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_versions');
  }

  canSelect<TReturn>(query: Query<'canvas_versions', Schema, TReturn>): Query<'canvas_versions', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
