import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';
import { SCALAR, channelAccessArgs, scalarChannelBody } from '../core/channel-access';
import { guestCanvasAccessWhere, guestChannelAccessWhere, guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasFoldersACL extends BaseQueryACL<'canvas_folders'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_folders');
  }

  canSelect<TReturn>(query: Query<'canvas_folders', Schema, TReturn>, args?: SelectArgs): Query<'canvas_folders', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            exists('canvases', (c) => c.where(guestCanvasAccessWhere(this.ctx))),
            exists('channel', (ch) => ch.where(guestChannelAccessWhere(this.ctx))),
            exists('project', (p) => p.where(guestProjectAccessWhere(this.ctx))),
          ),
        );
    }

    // Scope by the folder's own workspaceId (same multi-workspace footgun as canvases —
    // the createdByUser hop keyed off the creator's home workspace) AND gate by membership:
    // - channel folders (channelId set) require membership of that channel,
    // - project folders (channelId null, projectId set) require membership of a project channel,
    // - personal folders (both null) are limited to the creator.
    const { channelId } = channelAccessArgs(args);
    if (channelId) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(({ or, and, cmp, exists }) =>
          or(
            cmp('createdBy', this.ctx.userID),
            exists('channel', scalarChannelBody(this.ctx, channelId, true), SCALAR),
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

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, and, cmp, exists }) =>
        or(
          cmp('createdBy', this.ctx.userID),
          exists('channel', (ch) =>
            ch.whereExists('participants', (p) => p.where('userId', this.ctx.userID)),
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
