import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class OrganizationsACL extends BaseQueryACL<'organizations'> {
  constructor(ctx: Context) {
    super(ctx, 'organizations');
  }

  canSelect<TReturn>(query: Query<'organizations', Schema, TReturn>): Query<'organizations', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('createdBy', this.ctx.userID),
        exists('members', (om) => om.where('userId', this.ctx.userID))
      )
    );
  }
}
