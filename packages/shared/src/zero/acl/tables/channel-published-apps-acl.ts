import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

/**
 * Published apps are visible to whoever can see the channel — the same rule as
 * the channel itself. Guests get none: a published app is only openable by
 * members of its workspace, so there is nothing for a guest to show.
 */
export class ChannelPublishedAppsACL extends BaseQueryACL<'channel_published_apps'> {
  constructor(ctx: Context) {
    super(ctx, 'channel_published_apps');
  }

  canSelect<TReturn>(
    query: Query<'channel_published_apps', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'channel_published_apps', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'channelId');
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query.whereExists('channel', ch => ch.where(channelAccessWhere(this.ctx)));
  }
}
