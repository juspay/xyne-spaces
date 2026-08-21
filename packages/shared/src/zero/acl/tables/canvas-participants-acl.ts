
import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { guestCanvasAccessWhere, isGuestContext } from '../core/guest-acl-utils';

export class CanvasParticipantsACL extends BaseQueryACL<'canvas_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_participants');
  }
​
  canSelect<TReturn>(query: Query<'canvas_participants', Schema, TReturn>): Query<'canvas_participants', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return query.where(({ exists, cmp, or }) =>
        or(
          cmp('userId', this.ctx.userID),
          exists('canvas', (c) => c.where(guestCanvasAccessWhere(this.ctx)))
        )
      );
    }

    return query.where(({ exists, cmp, or }) =>
      or(
        cmp('userId', this.ctx.userID),
        exists('userGroup', (ug) =>
          ug.whereExists('userGroupMappings', (m) => m.where('userId', this.ctx.userID)),
        ),
        exists('channel', (ch) =>
          ch.whereExists('participants', (cp) => cp.where('userId', this.ctx.userID)),
        ),
        exists('canvas', (c) =>
          c.where(({ or, exists, cmp }) =>
            or(
              cmp('createdBy', this.ctx.userID),
              cmp('visibility', '=', CanvasVisibility.PUBLIC),
              exists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
        )
      )
    );
  }
}
