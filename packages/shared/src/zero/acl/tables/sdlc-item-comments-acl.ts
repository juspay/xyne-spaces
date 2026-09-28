import type { Query } from '@rocicorp/zero';
import type { Context, Schema } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class SdlcItemCommentsACL extends BaseQueryACL<'sdlc_item_comments'> {
  constructor(ctx: Context) {
    super(ctx, 'sdlc_item_comments');
  }

  canSelect<TReturn>(
    query: Query<'sdlc_item_comments', Schema, TReturn>,
  ): Query<'sdlc_item_comments', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .whereExists('sdlcEntityLinks', (link) =>
        link.whereExists('channel', (channel) =>
          channel.whereExists('participants', (participant) =>
            participant.where('userId', '=', this.ctx.userID),
          ),
        ),
      );
  }
}
