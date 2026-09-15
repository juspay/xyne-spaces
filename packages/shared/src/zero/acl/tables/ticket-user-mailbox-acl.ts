import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';

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
    const owned = query.where('userId', this.ctx.userID);

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return owned.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return owned.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx)),
    );
  }
}
