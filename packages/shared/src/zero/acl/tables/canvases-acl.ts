import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestCanvasAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasesACL extends BaseQueryACL<'canvases'> {
  constructor(ctx: Context) {
    super(ctx, 'canvases');
  }

  canSelect<TReturn>(query: Query<'canvases', Schema, TReturn>): Query<'canvases', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .where('workspaceId', '=', this.ctx.workspaceId)
        .where(guestCanvasAccessWhere(this.ctx));
    }

    return query
      .where('workspaceId', '=', this.ctx.workspaceId)
      .where(({ or, cmp, exists }) =>
        or(
          cmp('createdBy', this.ctx.userID),
          cmp('visibility', '=', CanvasVisibility.PUBLIC),
          exists('participants', (p) => p.where('userId', this.ctx.userID)),
          exists('channel', (ch) =>
            ch.whereExists('participants', (cp) => cp.where('userId', this.ctx.userID)),
          ),
        ),
      );
  }
}
