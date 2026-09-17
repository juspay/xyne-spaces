import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class EmailSignaturesACL extends BaseQueryACL<'email_signatures'> {
  constructor(ctx: Context) {
    super(ctx, 'email_signatures');
  }

  canSelect<TReturn>(query: Query<'email_signatures', Schema, TReturn>): Query<'email_signatures', Schema, TReturn> {
    return query.where('userId', this.ctx.userID);
  }
}
