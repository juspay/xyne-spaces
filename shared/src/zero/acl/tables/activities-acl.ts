import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ActivitiesACL extends BaseQueryACL<'activities'> {
  constructor(ctx: Context) {
    super(ctx, 'activities');
  }

  canSelect<TReturn>(query: Query<'activities', Schema, TReturn>): Query<'activities', Schema, TReturn> {
    return query.where('userId', this.ctx.userID);
  }
}
