import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class EmailChannelPreferencesACL extends BaseQueryACL<'email_channel_preferences'> {
  constructor(ctx: Context) {
    super(ctx, 'email_channel_preferences');
  }

  canSelect<TReturn>(query: Query<'email_channel_preferences', Schema, TReturn>, args?: SelectArgs): Query<'email_channel_preferences', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'channelId');
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query.whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR);
    }

    return query.whereExists('channel', (ch) =>
      ch.where(channelAccessWhere(this.ctx))
    );
  }
}
