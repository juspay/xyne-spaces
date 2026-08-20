import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasSuggestionsACL extends BaseQueryACL<'canvas_suggestions'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_suggestions');
  }

  canSelect<TReturn>(
    query: Query<'canvas_suggestions', Schema, TReturn>
  ): Query<'canvas_suggestions', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
