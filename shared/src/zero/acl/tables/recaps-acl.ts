import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RecapsACL extends BaseQueryACL<'recaps'> {
  constructor(ctx: Context) {
    super(ctx, 'recaps');
  }

  canSelect<TReturn>(query: Query<'recaps', Schema, TReturn>): Query<'recaps', Schema, TReturn> {
    // Users can see recaps where:
    // 1. They are the userId (personal recaps)
    // 2. OR it's a base recap (userId IS NULL)
    return query.where(({ cmp, or }) =>
      or(
        cmp('userId', '=', this.ctx.userID),
        cmp('userId', 'IS', null)
      )
    );
  }
}