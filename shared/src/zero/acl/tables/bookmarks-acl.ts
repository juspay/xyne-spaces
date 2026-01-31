import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class BookmarksACL extends BaseQueryACL<'bookmarks'> {
  constructor(ctx: Context) {
    super(ctx, 'bookmarks');
  }

  canSelect<TReturn>(query: Query<'bookmarks', Schema, TReturn>): Query<'bookmarks', Schema, TReturn> {
    return query.where('userId', this.ctx.userID);
  }
}
