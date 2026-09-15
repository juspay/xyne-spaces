import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelScopeType, GuestEntity, WorkspaceRole } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class BoardComplexityScoresACL extends BaseQueryACL<'board_complexity_scores'> {
  constructor(ctx: Context) {
    super(ctx, 'board_complexity_scores');
  }

  canSelect<TReturn>(
    query: Query<'board_complexity_scores', Schema, TReturn>,
  ): Query<'board_complexity_scores', Schema, TReturn> {
    if (this.ctx.role === WorkspaceRole.GUEST) {
      return query.whereExists('board', (b) =>
        b
          .where('workspaceId', '=', this.ctx.workspaceId)
          .whereExists('project', (p) =>
            p.where(({ or, exists }) =>
              or(
                exists('channels', (ch) =>
                  ch.whereExists('guestAccess', (m) =>
                    m
                      .where('userId', '=', this.ctx.userID)
                      .where('accessibleEntityType', '=', GuestEntity.CHANNEL),
                  ),
                ),
                exists('channels', (ch) =>
                  ch
                    .where('scopeType', '!=', ChannelScopeType.DM)
                    .where('scopeType', '!=', ChannelScopeType.GROUP_DM)
                    .whereExists('participants', (p) =>
                      p.where('userId', '=', this.ctx.userID),
                    ),
                ),
              ),
            ),
          ),
      );
    }

    // Optimized: board has direct workspaceId (1 hop instead of 2)
    return query.whereExists('board', (b) =>
      b.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
