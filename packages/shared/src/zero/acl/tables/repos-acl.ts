import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class ReposACL extends BaseQueryACL<'repos'> {
  constructor(ctx: Context) {
    super(ctx, 'repos');
  }

  canSelect<TReturn>(query: Query<'repos', Schema, TReturn>): Query<'repos', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          // Legacy IDE repositories are not SDLC hubs.
          cmp('channelId', 'IS', null),
          exists('channel', (channel) =>
            channel.whereExists('participants', (participant) =>
              participant.where('userId', '=', this.ctx.userID),
            ),
          ),
        ),
      );
  }
}
