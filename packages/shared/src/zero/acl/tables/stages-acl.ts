import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class StagesACL extends BaseQueryACL<'stages'> {
  constructor(ctx: Context) {
    super(ctx, 'stages');
  }

  canSelect<TReturn>(query: Query<'stages', Schema, TReturn>): Query<'stages', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('board', (boardQuery) =>
        boardQuery
          .where('workspaceId', '=', this.ctx.workspaceId)
          .whereExists('project', (projectQuery) =>
            projectQuery.where(guestProjectAccessWhere(this.ctx))
          )
      );
    }

    // Scope to the board's workspace only — match BoardsACL (boards are workspace-
    // visible). The old project→channels participation gate hid stages (empty board
    // columns) from workspace members who could open the board but weren't channel
    // participants.
    return query.whereExists('board', (boardQuery) =>
      boardQuery.where('workspaceId', '=', this.ctx.workspaceId),
    );
  }
}
