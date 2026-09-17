import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CustomEmojisACL extends BaseQueryACL<'custom_emojis'> {
  constructor(ctx: Context) {
    super(ctx, 'custom_emojis');
  }

  canSelect<TReturn>(query: Query<'custom_emojis', Schema, TReturn>): Query<'custom_emojis', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
