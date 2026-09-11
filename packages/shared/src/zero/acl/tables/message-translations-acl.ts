import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class MessageTranslationsACL extends BaseQueryACL<'message_translations'> {
  constructor(ctx: Context) {
    super(ctx, 'message_translations');
  }

  canSelect<TReturn>(
    query: Query<'message_translations', Schema, TReturn>,
  ): Query<'message_translations', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
