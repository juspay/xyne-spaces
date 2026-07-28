import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestCanvasAccessWhere, guestChannelAccessWhere, guestProjectAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasFoldersACL extends BaseQueryACL<'canvas_folders'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_folders');
  }

  canSelect<TReturn>(query: Query<'canvas_folders', Schema, TReturn>): Query<'canvas_folders', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .whereExists('createdByUser', (u) =>
          u.where('workspaceId', '=', this.ctx.workspaceId),
        )
        .where(({ or, cmp, exists }) =>
          or(
            cmp('createdBy', '=', this.ctx.userID),
            exists('canvases', (c) => c.where(guestCanvasAccessWhere(this.ctx))),
            exists('channel', (ch) => ch.where(guestChannelAccessWhere(this.ctx))),
            exists('project', (p) => p.where(guestProjectAccessWhere(this.ctx))),
          ),
        );
    }

    return query.whereExists('createdByUser', u =>
      u.where('workspaceId', '=', this.ctx.workspaceId),
    );
  }
}
