import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

// A mailbox overlay row is private to its owner (userId). A user may read it only when
// it's theirs AND they can see the underlying channel: either it's a public channel or
// they're a participant. Mirrors the per-user labels ACL (which gates on createdBy).
export class TicketUserMailboxACL extends BaseQueryACL<'ticket_user_mailbox'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_user_mailbox');
  }

  canSelect<TReturn>(
    query: Query<'ticket_user_mailbox', Schema, TReturn>,
  ): Query<'ticket_user_mailbox', Schema, TReturn> {
    return query
      .where('userId', this.ctx.userID)
      .whereExists('channel', (ch) =>
        ch.where(({ or, cmp, exists }) =>
          or(
            cmp('visibility', ChannelVisibility.PUBLIC),
            exists('participants', (p) => p.where('userId', this.ctx.userID)),
          ),
        ),
      );
  }
}
