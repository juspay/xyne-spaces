import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CallType, CallVisibility, EntityUserAccess, ShareableEntityType } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestChannelAccessWhere, isGuestContext } from '../core/guest-acl-utils';

/**
 * A live `entity_access` row of `entityType` reaching the viewer directly or through
 * a group/channel they belong to. Recordings and regular calls each have their own
 * entity type, so neither can widen the other's audience.
 *
 * A module function rather than a private method: query-acl-factory casts between
 * table ACLs structurally, and a private member would make CallsACL nominal.
 */
const shareIsActiveForViewer = <TReturn>(
  share: Query<'entity_access', Schema, TReturn>,
  ctx: Context,
  entityType: ShareableEntityType,
): Query<'entity_access', Schema, TReturn> =>
  share
    .where('workspaceId', ctx.workspaceId)
    .where('shareableEntityType', entityType)
    .where('entityUserAccess', '!=', EntityUserAccess.REVOKED)
    .where(({ or, cmp, exists }) =>
      or(
        cmp('userId', ctx.userID),
        exists('userGroupMemberships', m => m.where('userId', ctx.userID)),
        exists('channelMembers', m => m.where('userId', ctx.userID)),
      ),
    );

export class CallsACL extends BaseQueryACL<'calls'> {
  constructor(ctx: Context) {
    super(ctx, 'calls');
  }

  canSelect<TReturn>(query: Query<'calls', Schema, TReturn>): Query<'calls', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, and, cmp, exists }) =>
        or(
          cmp('createdByUserId', this.ctx.userID),
          and(
            cmp('callType', CallType.HEADLESS),
            exists('shares', share =>
              shareIsActiveForViewer(share, this.ctx, ShareableEntityType.NOTE_TAKER),
            ),
          ),
          and(
            cmp('callType', '!=', CallType.HEADLESS),
            exists('shares', share =>
              shareIsActiveForViewer(share, this.ctx, ShareableEntityType.CALL),
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

    return query.where(({ or, and, cmp, exists }) =>
      or(
        cmp('createdByUserId', this.ctx.userID),
        and(
          cmp('callType', CallType.HEADLESS),
          exists('shares', share =>
            shareIsActiveForViewer(share, this.ctx, ShareableEntityType.NOTE_TAKER),
          ),
        ),
        and(
          cmp('callType', '!=', CallType.HEADLESS),
          exists('shares', share =>
            shareIsActiveForViewer(share, this.ctx, ShareableEntityType.CALL),
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
