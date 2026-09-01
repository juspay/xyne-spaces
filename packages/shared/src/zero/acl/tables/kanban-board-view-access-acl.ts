import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class KanbanBoardViewAccessACL extends BaseQueryACL<'kanban_board_view_access'> {
  constructor(ctx: Context) {
    super(ctx, 'kanban_board_view_access');
  }

  canSelect<TReturn>(
    query: Query<'kanban_board_view_access', Schema, TReturn>,
  ): Query<'kanban_board_view_access', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query.where(({ or, cmp }) =>
      or(
        cmp('userId', '=', this.ctx.userID),
        cmp('sharedBy', '=', this.ctx.userID),
      ),
    );
  }
}
