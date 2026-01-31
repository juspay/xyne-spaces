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
    // Users can only see board weights for groups they belong to
    return query.whereExists('userGroup', (userGroupQuery) => {
      return userGroupQuery.whereExists('userGroupMappings', (mappingQuery) => {
        return mappingQuery.where('userId', this.ctx.userID);
      });
    });
  }
}
