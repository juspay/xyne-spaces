import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';

export class EmailDraftsACL extends BaseQueryACL<'email_drafts'> {
  constructor(ctx: Context) {
    super(ctx, 'email_drafts');
  }

  canSelect<TReturn>(query: Query<'email_drafts', Schema, TReturn>, args?: SelectArgs): Query<'email_drafts', Schema, TReturn> {
    const channelId = args?.channelId as string | undefined;

    // A user can read either their own draft (userId = me) or the shared
    // AI-seeded draft (userId IS NULL). The hook prefers the personal draft
    // when present and falls back to the AI one. Channel-membership gating
    // is layered on top so drafts only surface for channels the user can see.
    const ownDrafts = query.where(({ or, cmp }) =>
      or(cmp('userId', '=', this.ctx.userID), cmp('userId', 'IS', null)),
    );

    if (args?.isMember && channelId) {
      return ownDrafts.whereExists('channel', (ch) =>
        ch.whereExists('participants', (p) =>
          p.where('userId', this.ctx.userID).where('channelId', channelId),
          { scalar: true }
        ),
      );
    }

    if (args?.isMember === false && channelId) {
      return ownDrafts.whereExists('channel', (ch) =>
        ch.where("id", channelId).where('visibility', ChannelVisibility.PUBLIC),
        { scalar: true }
      );
    }

    return ownDrafts.whereExists('channel', (ch) =>
      ch.where(({ or, cmp, exists }) =>
        or(
          cmp('visibility', ChannelVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID))
        )
      )
    );
  }
}
