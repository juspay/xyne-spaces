import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasUserStatusACL extends BaseQueryACL<'canvas_user_status'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_user_status');
  }

  canSelect<TReturn>(
    query: Query<'canvas_user_status', Schema, TReturn>,
  ): Query<'canvas_user_status', Schema, TReturn> {
    return query.where('userId', this.ctx.userID);
  }
}
