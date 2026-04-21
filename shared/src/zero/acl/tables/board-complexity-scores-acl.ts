import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class BoardComplexityScoresACL extends BaseQueryACL<'board_complexity_scores'> {
  constructor(ctx: Context) {
    super(ctx, 'board_complexity_scores');
  }

  canSelect<TReturn>(
    query: Query<'board_complexity_scores', Schema, TReturn>,
  ): Query<'board_complexity_scores', Schema, TReturn> {
    // Optimized: board has direct workspaceId (1 hop instead of 2)
    return query.whereExists('board', (b) =>
      b.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
