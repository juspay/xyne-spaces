import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class MessagesACL extends BaseQueryACL<'messages'> {
  constructor(ctx: Context) {
    super(ctx, 'messages');
  }

  canSelect<TReturn>(query: Query<'messages', Schema, TReturn>, args?: SelectArgs): Query<'messages', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where(({ or, cmp }) =>
          or(
            cmp('visibleTo', 'IS', null),
            cmp('visibleTo', this.ctx.userID),
          ),
        )
        .whereExists('conversation', (c) =>
          c.whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(guestChannelAccessWhere(this.ctx)),
          ),
        );
    }

    const withVisibleTo = query.where(({ or, cmp }) => {
      return or(
        cmp('visibleTo', 'IS', null),
        cmp('visibleTo', this.ctx.userID)
      );
    });

    // Fast paths: when the query is scoped to one channel/conversation (the
    // arg matches the query's own filter by convention), the channel-access
    // decision is row-invariant — pin the unique key with a literal so the
    // scalar exists resolves ONCE per hydration instead of probing
    // channel/participants per message row. Membership is still verified
    // against ctx.userID; a non-simple scalar silently falls back to the
    // per-row EXISTS, so this can only improve cost, never widen access.
    const channelId = args?.channelId as string | undefined;
    const conversationId = args?.conversationId as string | undefined;

    if (channelId) {
      return withVisibleTo.whereExists('conversation', (c) =>
        c.where('channelId', channelId).whereExists('channel', (ch) =>
          ch
            .where('id', channelId)
            .where('workspaceId', '=', this.ctx.workspaceId)
            .where(({ or, cmp, exists }) =>
              or(
                cmp('visibility', '=', ChannelVisibility.PUBLIC),
                exists('participants', (p) => p.where('userId', this.ctx.userID))
              )
            ),
          { scalar: true }
        )
      );
    }

    if (conversationId) {
      return withVisibleTo.whereExists('conversation', (c) =>
        c
          .where('conversationId', conversationId)
          .whereExists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(({ or, cmp, exists }) =>
                or(
                  cmp('visibility', '=', ChannelVisibility.PUBLIC),
                  exists('participants', (p) => p.where('userId', this.ctx.userID))
                )
              )
          ),
        { scalar: true }
      );
    }

    return withVisibleTo.whereExists('conversation', (c) =>
      c.whereExists('channel', (ch) =>
        ch
          .where('workspaceId', '=', this.ctx.workspaceId)
          .where(({ or, cmp, exists }) =>
            or(
              cmp('visibility', '=', ChannelVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
      )
    );
  }
}
