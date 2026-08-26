import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import {
  guestProjectAccessWhere,
  isGuestContext,
  connectChannelAccessWhere,
} from '../core/guest-acl-utils';

export class StagesACL extends BaseQueryACL<'stages'> {
  constructor(ctx: Context) {
    super(ctx, 'stages');
  }

  // NOTE: 'stages' is opted out of the define-query.ts workspace backstop (Slack-Connect),
  // so every branch must be fully self-scoping. Connect arm: the board's project has a
  // channel where I am an active connect member.
  canSelect<TReturn>(query: Query<'stages', Schema, TReturn>): Query<'stages', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.whereExists('board', (boardQuery: any) =>
        boardQuery.where(({ or, and, cmp, exists }: any) =>
          or(
            and(
              cmp('workspaceId', '=', this.ctx.workspaceId),
              exists('project', (projectQuery: any) =>
                projectQuery.where(guestProjectAccessWhere(this.ctx)),
              ),
            ),
            exists('project', (projectQuery: any) =>
              projectQuery.whereExists('channels', (ch: any) =>
                ch.where(connectChannelAccessWhere(this.ctx)),
              ),
            ),
          ),
        ),
      );
    }

    // Same-workspace: scope to the board's workspace (boards are workspace-visible; a
    // participation gate would hide empty board columns from non-participant members).
    // Connect: admit boards whose project has a connect-accessible channel.
    return query.whereExists('board', (boardQuery: any) =>
      boardQuery.where(({ or, cmp, exists }: any) =>
        or(
          cmp('workspaceId', '=', this.ctx.workspaceId),
          exists('project', (projectQuery: any) =>
            projectQuery.whereExists('channels', (ch: any) =>
              ch.where(connectChannelAccessWhere(this.ctx)),
            ),
          ),
        ),
      ),
    );
  }
}
