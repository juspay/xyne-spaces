import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class StageTransitionsACL extends BaseQueryACL<'stage_transitions'> {
  constructor(ctx: Context) {
    super(ctx, 'stage_transitions');
  }

  canSelect<TReturn>(
    query: Query<'stage_transitions', Schema, TReturn>,
  ): Query<'stage_transitions', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('board', (boardQuery) =>
        boardQuery
          .where('workspaceId', '=', this.ctx.workspaceId)
          .whereExists('project', (projectQuery) =>
            projectQuery.where(guestProjectAccessWhere(this.ctx)),
          ),
      );
    }

    // Scope to the board's workspace only — match StagesACL/BoardsACL (workspace-
    // visible). The old project→channels participation gate hid transitions from
    // workspace members who weren't channel participants.
    return query.whereExists('board', (boardQuery) =>
      boardQuery.where('workspaceId', '=', this.ctx.workspaceId),
    );
  }
}
