import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, channelAccessWhere, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class MessageAttachmentsACL extends BaseQueryACL<'message_attachments'> {
  constructor(ctx: Context) {
    super(ctx, 'message_attachments');
  }

  canSelect<TReturn>(query: Query<'message_attachments', Schema, TReturn>, args?: SelectArgs): Query<'message_attachments', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            exists('conversation', (c) =>
              c.whereExists('channel', (ch) =>
                ch
                  .where('workspaceId', '=', this.ctx.workspaceId)
                  .where(guestChannelAccessWhere(this.ctx)),
              ),
            ),
          ),
        );
    }

    const { channelId, isMember } = channelAccessArgs(args);
    if (channelId) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            exists('conversation', (c) =>
              c
                .where('channelId', channelId)
                .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR),
            ),
          ),
        );
    }

    // Mirror the parent MessagesACL predicate: an attachment is visible when its
    // conversation's channel is in the caller's workspace and is either PUBLIC or one the
    // caller participates in. Attachments the caller uploaded stay visible regardless, so a
    // draft/in-flight attachment that is not yet linked to a conversation is not hidden.
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('createdBy', '=', this.ctx.userID),
          exists('conversation', (c) =>
            c.whereExists('channel', (ch) =>
              ch
                .where('workspaceId', '=', this.ctx.workspaceId)
                .where(({ or: or2, cmp: cmp2, exists: exists2 }) =>
                  or2(
                    cmp2('visibility', '=', ChannelVisibility.PUBLIC),
                    exists2('participants', (p) => p.where('userId', this.ctx.userID)),
                  ),
                ),
            ),
          ),
        ),
      );
  }
}
