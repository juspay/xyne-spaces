import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { AttachmentEntityType, UNSENT_ATTACHMENT_ENTITY_TYPES } from '../../types';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import {
  SCALAR,
  channelAccessArgs,
  channelAccessWhere,
  scalarChannelBody,
} from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class MessageAttachmentsACL extends BaseQueryACL<'message_attachments'> {
  constructor(ctx: Context) {
    super(ctx, 'message_attachments');
  }

  canSelect<TReturn>(
    query: Query<'message_attachments', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'message_attachments', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, and, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            and(
              cmp('entityType', 'NOT IN', UNSENT_ATTACHMENT_ENTITY_TYPES),
              exists('conversation', c =>
                c.whereExists('channel', ch =>
                  ch
                    .where('workspaceId', '=', this.ctx.workspaceId)
                    .where(guestChannelAccessWhere(this.ctx)),
                ),
              ),
            ),
            and(
              cmp('entityType', '=', AttachmentEntityType.SDLC_HUB),
              exists('hubChannel', ch =>
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
        .where(({ or, and, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            and(
              cmp('entityType', 'NOT IN', UNSENT_ATTACHMENT_ENTITY_TYPES),
              exists('conversation', c =>
                c
                  .where('channelId', channelId)
                  .whereExists('channel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR),
              ),
            ),
            and(
              cmp('entityType', '=', AttachmentEntityType.SDLC_HUB),
              cmp('entityId', '=', channelId),
              exists('hubChannel', scalarChannelBody(this.ctx, channelId, isMember), SCALAR),
            ),
          ),
        );
    }

    // Mirror the parent MessagesACL predicate: an attachment is visible when its
    // conversation's channel is in the caller's workspace and is either PUBLIC or one the
    // caller participates in. Attachments the caller uploaded stay visible regardless, so a
    // draft/in-flight attachment that is not yet linked to a conversation is not hidden.
    // The conversation arm covers sent content only. Rows belonging to an unsent message are
    // reached through the ownership arm instead, keeping them consistent with draft_messages.
    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, and, cmp, exists }) =>
        or(
          cmp('createdBy', '=', this.ctx.userID),
          and(
            cmp('entityType', 'NOT IN', UNSENT_ATTACHMENT_ENTITY_TYPES),
            exists('conversation', (c) =>
              // Pin the join direction — see tickets-acl.ts for the full rationale.
              // Prod: this arm flipped is the getConversationAttachementsV2
              // 60k-channel scan (73s worst-case materializations, 2026-09-15).
              c.whereExists('channel', (ch) =>
                ch
                  .where('workspaceId', '=', this.ctx.workspaceId)
                  .where(({ or: or2, cmp: cmp2, exists: exists2 }) =>
                    or2(
                      cmp2('visibility', '=', ChannelVisibility.PUBLIC),
                      exists2('participants', (p) => p.where('userId', this.ctx.userID)),
                    ),
                  ),
                { flip: false },
              ),
            ),
          ),
          and(
            cmp('entityType', '=', AttachmentEntityType.SDLC_HUB),
            exists('hubChannel', (ch) =>
              ch
                .where('workspaceId', '=', this.ctx.workspaceId)
                .where(({ or: or3, cmp: cmp3, exists: exists3 }) =>
                  or3(
                    cmp3('visibility', '=', ChannelVisibility.PUBLIC),
                    exists3('participants', (p) => p.where('userId', this.ctx.userID)),
                  ),
                ),
            ),
          ),
        ),
      );
  }
}
