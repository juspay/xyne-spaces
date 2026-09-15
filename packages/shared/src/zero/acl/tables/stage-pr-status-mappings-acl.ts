import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class StagePRStatusMappingsACL extends BaseQueryACL<'stage_pr_status_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'stage_pr_status_mappings');
  }

  canSelect<TReturn>(query: Query<'stage_pr_status_mappings', Schema, TReturn>): Query<'stage_pr_status_mappings', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('stage', (stageQuery) =>
        stageQuery.whereExists('board', (boardQuery) =>
          boardQuery
            .where('workspaceId', '=', this.ctx.workspaceId)
            .whereExists('project', (projectQuery) =>
              projectQuery.where(guestProjectAccessWhere(this.ctx))
            )
        )
      );
    }

    // Scope to the board's workspace via stage -> board — match StagesACL/BoardsACL.
    // The old project→channels participation gate hid mappings from workspace members
    // who could see the board but weren't channel participants (empty board columns).
    return query.whereExists('stage', (stageQuery) =>
      stageQuery.whereExists('board', (boardQuery) =>
        boardQuery.where('workspaceId', '=', this.ctx.workspaceId),
      ),
    );
  }
}
