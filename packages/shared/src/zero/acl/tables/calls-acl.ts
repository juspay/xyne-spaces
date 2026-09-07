import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CallType, CallVisibility, EntityUserAccess, ShareableEntityType } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, scalarChannelBody } from '../core/channel-access';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CallsACL extends BaseQueryACL<'calls'> {
  constructor(ctx: Context) {
    super(ctx, 'calls');
  }

  canSelect<TReturn>(query: Query<'calls', Schema, TReturn>, args?: SelectArgs): Query<'calls', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, and, cmp, exists }) =>
        or(
          cmp('createdByUserId', this.ctx.userID),
          and(
            cmp('callType', CallType.HEADLESS),
            exists('shares', share =>
              share
                .where('workspaceId', this.ctx.workspaceId)
                .where('shareableEntityType', ShareableEntityType.NOTE_TAKER)
                .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
                .where(({ or: shareOr, cmp: shareCmp, exists: shareExists }) =>
                  shareOr(
                    shareCmp('userId', this.ctx.userID),
                    shareExists('userGroupMemberships', m => m.where('userId', this.ctx.userID)),
                    shareExists('channelMembers', m => m.where('userId', this.ctx.userID)),
                  ),
                ),
            ),
          ),
          and(
            cmp('workspaceId', this.ctx.workspaceId),
            cmp('callType', CallType.HEADLESS),
            cmp('visibility', CallVisibility.PUBLIC),
          ),
          exists('participants', (p) => p.where('userId', this.ctx.userID)),
          exists('channel', (ch) =>
            ch
              .where('workspaceId', '=', this.ctx.workspaceId)
              .where(guestChannelAccessWhere(this.ctx)),
          ),
        ),
      );
    }

    // Optimization only: when the caller subscribes with a concrete channelId, the
    // channel-membership branch below is a correlated single-row lookup, so mark it
    // scalar. All access rules are identical to the generic path (main's logic).
    const { channelId } = channelAccessArgs(args);
    if (channelId) {
      return query.where(({ or, and, cmp, exists }) =>
        or(
          cmp('createdByUserId', this.ctx.userID),
          and(
            cmp('callType', CallType.HEADLESS),
            exists('shares', share =>
              share
                .where('workspaceId', this.ctx.workspaceId)
                .where('shareableEntityType', ShareableEntityType.NOTE_TAKER)
                .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
                .where(({ or: shareOr, cmp: shareCmp, exists: shareExists }) =>
                  shareOr(
                    shareCmp('userId', this.ctx.userID),
                    shareExists('userGroupMemberships', m => m.where('userId', this.ctx.userID)),
                    shareExists('channelMembers', m => m.where('userId', this.ctx.userID)),
                  ),
                ),
            ),
          ),
          and(
            cmp('workspaceId', this.ctx.workspaceId),
            cmp('callType', CallType.HEADLESS),
            cmp('visibility', CallVisibility.PUBLIC),
          ),
          exists('participants', (p) => p.where('userId', this.ctx.userID)),
          exists('channel', scalarChannelBody(this.ctx, channelId, true), SCALAR),
        )
      );
    }

    return query.where(({ or, and, cmp, exists }) =>
      or(
        cmp('createdByUserId', this.ctx.userID),
        and(
          cmp('callType', CallType.HEADLESS),
          exists('shares', share =>
            share
              .where('workspaceId', this.ctx.workspaceId)
              .where('shareableEntityType', ShareableEntityType.NOTE_TAKER)
              .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
              .where(({ or: shareOr, cmp: shareCmp, exists: shareExists }) =>
                shareOr(
                  shareCmp('userId', this.ctx.userID),
                  shareExists('userGroupMemberships', m => m.where('userId', this.ctx.userID)),
                  shareExists('channelMembers', m => m.where('userId', this.ctx.userID)),
                ),
              ),
          ),
        ),
        and(
          cmp('workspaceId', this.ctx.workspaceId),
          cmp('callType', CallType.HEADLESS),
          cmp('visibility', CallVisibility.PUBLIC),
        ),
        exists('participants', (p) => p.where('userId', this.ctx.userID)),
        exists('channel', (ch) =>
          ch
            .where('workspaceId', '=', this.ctx.workspaceId)
            .whereExists('participants', (p) => p.where('userId', this.ctx.userID))
        ),
      ),
    );
  }
}
