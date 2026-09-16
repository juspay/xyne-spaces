import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class DraftMessagesACL extends BaseQueryACL<'draft_messages'> {
  constructor(ctx: Context) {
    super(ctx, 'draft_messages');
  }

  canSelect<TReturn>(query: Query<'draft_messages', Schema, TReturn>): Query<'draft_messages', Schema, TReturn> {
    // Owner pin normalized into the ACL (was query-only in `userDrafts .where('userId', me)`).
    // Behavior-preserving: the sole reader already filters userId, so the intersection is unchanged
    // — it only tightens the ACL. This makes draft_messages eligible for the row-level sync plane,
    // whose eligibility predicate reads the ACL alone (owner pin must live in canSelect, not the query).
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where('userId', '=', this.ctx.userID);
  }
}
