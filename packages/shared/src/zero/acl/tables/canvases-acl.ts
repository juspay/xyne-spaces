import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  connectChannelAccessWhere,
  guestCanvasAccessWhere,
  isGuestContext,
} from '../core/guest-acl-utils';

export class CanvasesACL extends BaseQueryACL<'canvases'> {
  constructor(ctx: Context) {
    super(ctx, 'canvases');
  }

  // NOTE: 'canvases' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  // A canvas is visible if it belongs to my workspace (creator hop) OR its channel is a connect
  // channel I actively belong to. Only the CHANNEL-scoped path is relaxed; project/personal
  // canvases stay clamped to my workspace via the creator hop.
  canSelect<TReturn>(query: Query<'canvases', Schema, TReturn>): Query<'canvases', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where((h: any) => {
        const { or, and, exists } = h;
        return or(
          and(
            exists('createdByUser', (u: any) =>
              u.where('workspaceId', '=', this.ctx.workspaceId),
            ),
            guestCanvasAccessWhere(this.ctx)(h),
          ),
          exists('channel', (ch: any) =>
          ch.whereExists('connectMembers', (m: any) =>
            m.where('userId', '=', this.ctx.userID).where('leftAt', 'IS', null),
          ),
        ),
        );
      });
    }

    return query.where(({ or, exists }: any) =>
      or(
        exists('createdByUser', (u: any) => u.where('workspaceId', '=', this.ctx.workspaceId)),
        exists('channel', (ch: any) =>
          ch.whereExists('connectMembers', (m: any) =>
            m.where('userId', '=', this.ctx.userID).where('leftAt', 'IS', null),
          ),
        ),
      ),
    );
  }
}
