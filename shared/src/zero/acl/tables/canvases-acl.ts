import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasesACL extends BaseQueryACL<'canvases'> {
  constructor(ctx: Context) {
    super(ctx, 'canvases');
  }

  canSelect<TReturn>(query: Query<'canvases', Schema, TReturn>): Query<'canvases', Schema, TReturn> {
    return query.whereExists('createdByUser', (u) => u.where('workspaceId', '=', this.ctx.workspaceId));
  }
}
