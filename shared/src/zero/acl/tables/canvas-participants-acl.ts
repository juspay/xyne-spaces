import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { CanvasVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasParticipantsACL extends BaseQueryACL<'canvas_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_participants');
  }

  canSelect<TReturn>(query: Query<'canvas_participants', Schema, TReturn>): Query<'canvas_participants', Schema, TReturn> {
    return query.where(({ exists, cmp, or }) =>
      or(
        cmp('userId', this.ctx.userID),
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
