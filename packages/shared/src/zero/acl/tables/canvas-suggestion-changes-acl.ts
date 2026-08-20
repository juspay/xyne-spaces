import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasSuggestionChangesACL extends BaseQueryACL<'canvas_suggestion_changes'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_suggestion_changes');
  }

  canSelect<TReturn>(
    query: Query<'canvas_suggestion_changes', Schema, TReturn>
  ): Query<'canvas_suggestion_changes', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
