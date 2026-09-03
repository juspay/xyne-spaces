import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';

// A mailbox overlay row is private to its owner (userId). A user may read it only when
// it's theirs AND they can see the underlying channel: either it's a public channel or
// they're a participant. Mirrors the per-user labels ACL (which gates on createdBy).
export class TicketUserMailboxACL extends BaseQueryACL<'ticket_user_mailbox'> {
  constructor(ctx: Context) {
    super(ctx, 'ticket_user_mailbox');
  }

  canSelect<TReturn>(
    query: Query<'ticket_user_mailbox', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'ticket_user_mailbox', Schema, TReturn> {
    const scoped = query.where('userId', this.ctx.userID);
    const channelId = args?.channelId as string | undefined;

    if (args?.isMember && channelId) {
      return scoped.whereExists('channel', (ch) =>
        ch.whereExists('participants', (p) =>
          p.where('userId', this.ctx.userID).where('channelId', channelId),
          { scalar: true }
        ),
      );
    }

    if (args?.isMember === false && channelId) {
      return scoped.whereExists('channel', (ch) =>
        ch.where('id', channelId).where('visibility', ChannelVisibility.PUBLIC),
        { scalar: true }
      );
    }

    return scoped.whereExists('channel', (ch) =>
      ch.where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', ChannelVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID)),
        ),
      ),
    );
  }
}
