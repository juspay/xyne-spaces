import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ApplicationReleaseTicketsACL extends BaseQueryACL<'application_release_tickets'> {
  constructor(ctx: Context) {
    super(ctx, 'application_release_tickets');
  }

  canSelect<TReturn>(query: Query<'application_release_tickets', Schema, TReturn>): Query<'application_release_tickets', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
