import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class EmailDraftsACL extends BaseQueryACL<'email_drafts'> {
  constructor(ctx: Context) {
    super(ctx, 'email_drafts');
  }

  canSelect<TReturn>(query: Query<'email_drafts', Schema, TReturn>, args?: SelectArgs): Query<'email_drafts', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where(({ or, cmp }) =>
          or(cmp('userId', '=', this.ctx.userID), cmp('userId', 'IS', null)),
        )
        .whereExists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(guestChannelAccessWhere(this.ctx)),
        );
    }

    // A user can read either their own draft (userId = me) or the shared
    // AI-seeded draft (userId IS NULL). The hook prefers the personal draft
    // when present and falls back to the AI one. Channel-membership gating
    // is layered on top so drafts only surface for channels the user can see.
    const ownDrafts = query.where(({ or, cmp }) =>
      or(cmp('userId', '=', this.ctx.userID), cmp('userId', 'IS', null)),
    );

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return ownDrafts.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return ownDrafts.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx))
    );
  }
}
