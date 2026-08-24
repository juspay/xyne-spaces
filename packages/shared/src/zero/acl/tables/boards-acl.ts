import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestProjectAccessWhere,
  isGuestContext,
  connectChannelAccessWhere,
} from '../core/guest-acl-utils';

export class BoardsACL extends BaseQueryACL<'boards'> {
  constructor(ctx: Context) {
    super(ctx, 'boards');
  }

  // NOTE: 'boards' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so every branch must be fully self-scoping. Connect arm: the board's project has a
  // channel where I am an active connect member.
  canSelect<TReturn>(query: Query<'boards', Schema, TReturn>): Query<'boards', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ or, and, cmp, exists }: any) =>
        or(
          and(
            cmp('workspaceId', '=', this.ctx.workspaceId),
            exists('project', (p: any) => p.where(guestProjectAccessWhere(this.ctx))),
          ),
          exists('project', (p: any) =>
            p.whereExists('channels', (ch: any) =>
              ch.where(connectChannelAccessWhere(this.ctx)),
            ),
          ),
        ),
      );
    }

    // Same-workspace: direct workspaceId check (boards are workspace-visible).
    // Connect: admit boards whose project has a connect-accessible channel.
    return query.where(({ or, cmp, exists }: any) =>
      or(
        cmp('workspaceId', '=', this.ctx.workspaceId),
        exists('project', (p: any) =>
          p.whereExists('channels', (ch: any) =>
            ch.where(connectChannelAccessWhere(this.ctx)),
          ),
        ),
      ),
    );
  }
}
