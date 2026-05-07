import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

/**
 * ACL for board_sla_policies.
 * Board SLA policies are scoped to the workspace — any member of the same
 * workspace as the board can read the policies. This mirrors the BoardsACL
 * which gates visibility on workspaceId.
 */
export class BoardSlaPoliciesACL extends BaseQueryACL<'board_sla_policies'> {
  constructor(ctx: Context) {
    super(ctx, 'board_sla_policies');
  }

  canSelect<TReturn>(
    query: Query<'board_sla_policies', Schema, TReturn>,
  ): Query<'board_sla_policies', Schema, TReturn> {
    // Filter through the board relation — board visibility is already gated by
    // workspaceId in BoardsACL, so checking the same condition here is correct.
    return query.whereExists('board', b =>
      b.where('workspaceId', this.ctx.workspaceId),
    );
  }
}
