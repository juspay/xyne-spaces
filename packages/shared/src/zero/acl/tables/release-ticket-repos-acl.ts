import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ReleaseTicketReposACL extends BaseQueryACL<'release_ticket_repos'> {
  constructor(ctx: Context) {
    super(ctx, 'release_ticket_repos');
  }

  canSelect<TReturn>(query: Query<'release_ticket_repos', Schema, TReturn>): Query<'release_ticket_repos', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
