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

    // Drafts are user-private: a draft belongs to the user who authored it.
    // Layer the channel-membership gate on top so a user can only read drafts
    // on channels they still have access to.
    const ownDrafts = query.where('userId', this.ctx.userID);

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
