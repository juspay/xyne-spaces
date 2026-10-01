import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { connectReach } from '../core/connect-reach';
import { guestCanvasAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasesACL extends BaseQueryACL<'canvases'> {
  constructor(ctx: Context) {
    super(ctx, 'canvases');
  }

  canSelect<TReturn>(query: Query<'canvases', Schema, TReturn>): Query<'canvases', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query
        .whereExists('createdByUser', (u) =>
          u.where('workspaceId', '=', this.ctx.workspaceId),
        )
        .where(guestCanvasAccessWhere(this.ctx));
    }

    // Slack Connect: connectId → connect_group workspace truth; else the creator's workspace.
    return query.where(
      connectReach(this.ctx, ({ exists }) =>
        exists('createdByUser', (u: { where: (...a: unknown[]) => unknown }) =>
          u.where('workspaceId', '=', this.ctx.workspaceId),
        ),
      ),
    );
  }
}
