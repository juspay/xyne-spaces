import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class TicketsACL extends BaseQueryACL<'tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'tickets');
  }

  canSelect<TReturn>(query: Query<'tickets', Schema, TReturn>): Query<'tickets', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
