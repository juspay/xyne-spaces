import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class DraftMessagesACL extends BaseQueryACL<'draft_messages'> {
  constructor(ctx: Context) {
    super(ctx, 'draft_messages');
  }

  canSelect<TReturn>(query: Query<'draft_messages', Schema, TReturn>): Query<'draft_messages', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
