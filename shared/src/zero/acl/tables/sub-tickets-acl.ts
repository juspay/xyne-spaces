import type { Query } from '@rocicorp/zero';
import {type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SubTicketsACL extends BaseQueryACL<'sub_tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'sub_tickets');
  }

  canSelect<TReturn>(query: Query<'sub_tickets', Schema, TReturn>): Query<'sub_tickets', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
