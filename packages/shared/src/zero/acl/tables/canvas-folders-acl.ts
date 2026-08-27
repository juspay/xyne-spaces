import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { channelVisibleWhere, guestCanvasAccessWhere, guestChannelAccessWhere, guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasFoldersACL extends BaseQueryACL<'canvas_folders'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_folders');
  }

  // NOTE: 'canvas_folders' is opted out of the define-query.ts workspace backstop (Slack-Connect).
  // The root `workspaceId = ctx` clamp is dropped so each OR branch is its own self-scoping fence:
  // channel folders gate through `channelVisibleWhere` (same-workspace membership OR active connect
  // membership); creator/project/personal branches remain self-scoped as before.
  canSelect<TReturn>(query: Query<'canvas_folders', Schema, TReturn>): Query<'canvas_folders', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            exists('canvases', (c) => c.where(guestCanvasAccessWhere(this.ctx))),
            exists('channel', (ch) =>
              ch.where(channelVisibleWhere(this.ctx, guestChannelAccessWhere(this.ctx))),
            ),
            exists('project', (p) => p.where(guestProjectAccessWhere(this.ctx))),
          ),
        );
    }

    // Gate by membership:
    // - channel folders (channelId set) require membership of that channel OR active connect
    //   membership of it (via channelVisibleWhere),
    // - project folders (channelId null, projectId set) require membership of a project channel,
    // - personal folders (both null) are limited to the creator.
    return query
      .where(({ or, and, cmp, exists }) =>
        or(
          cmp('createdBy', this.ctx.userID),
          exists('channel', (ch) =>
            ch.where(
              channelVisibleWhere(this.ctx, ({ exists: ex }: any) =>
                ex('participants', (p: any) => p.where('userId', this.ctx.userID)),
              ),
            ),
          ),
          and(
            cmp('channelId', 'IS', null),
            exists('project', (pr) =>
              pr.whereExists('channels', (ch) =>
                ch.whereExists('participants', (p) => p.where('userId', this.ctx.userID)),
              ),
            ),
          ),
        ),
      );
  }
}
