import type { Query } from '@rocicorp/zero';
import { type Schema, type Context, ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class StageTransitionsACL extends BaseQueryACL<'stage_transitions'> {
  constructor(ctx: Context) {
    super(ctx, 'stage_transitions');
  }

  canSelect<TReturn>(
    query: Query<'stage_transitions', Schema, TReturn>,
  ): Query<'stage_transitions', Schema, TReturn> {
    // Scope transition rows to the caller's workspace through the owning board,
    // mirroring StagesACL so board configuration cannot leak across workspaces.
    return query.whereExists('board', (boardQuery) =>
      boardQuery
        .where('workspaceId', '=', this.ctx.workspaceId)
        .whereExists('project', (projectQuery) =>
          projectQuery.whereExists('channels', (channelQuery) =>
            channelQuery.where(({ or, cmp, exists }) => {
              return or(
                cmp('visibility', ChannelVisibility.PUBLIC),
                exists('participants', (participants) =>
                  participants.where('userId', this.ctx.userID),
                ),
              );
            }),
          ),
        ),
    );
  }
}
