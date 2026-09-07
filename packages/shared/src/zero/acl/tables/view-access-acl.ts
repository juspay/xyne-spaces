import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ViewAccessEntityType } from '../../types';
import { BaseQueryACL } from '../core/base-acl';
import { denyGuestSelect, isGuestContext } from '../core/guest-acl-utils';

export class ViewAccessACL extends BaseQueryACL<'view_access'> {
  constructor(ctx: Context) {
    super(ctx, 'view_access');
  }

  canSelect<TReturn>(
    query: Query<'view_access', Schema, TReturn>,
  ): Query<'view_access', Schema, TReturn> {
    if (isGuestContext(this.ctx)) {
      return denyGuestSelect(query, 'id');
    }

    return query.where(({ or, and, cmp }) =>
      or(
        and(
          cmp('entityType', '=', ViewAccessEntityType.USER),
          cmp('entityId', '=', this.ctx.userID),
        ),
        cmp('sharedBy', '=', this.ctx.userID),
      ),
    );
  }
}
