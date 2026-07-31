import type { Query } from '@rocicorp/zero';
import { type Schema, type Context, ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class StagePRStatusMappingsACL extends BaseQueryACL<'stage_pr_status_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'stage_pr_status_mappings');
  }

  canSelect<TReturn>(query: Query<'stage_pr_status_mappings', Schema, TReturn>): Query<'stage_pr_status_mappings', Schema, TReturn> {
    // Users can see PR status mappings for stages in boards they have access to
    // Access chain: stage_pr_status_mappings -> stage -> board (with workspaceId) -> project -> channels -> participants
    return query.whereExists('stage', (stageQuery) =>
      stageQuery.whereExists('board', (boardQuery) =>
        boardQuery
          .where('workspaceId', '=', this.ctx.workspaceId)
          .whereExists('project', (projectQuery) =>
            projectQuery.whereExists('channels', (channelQuery) =>
              channelQuery.where(({or, cmp, exists}) => {
                return or(
                  cmp("visibility", ChannelVisibility.PUBLIC),
                  exists("participants", participants => participants.where("userId", this.ctx.userID))
                )
              })
            )
          )
      )
    );
  }
}