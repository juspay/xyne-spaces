import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CanvasFoldersACL extends BaseQueryACL<'canvas_folders'> {
  constructor(ctx: Context) {
    super(ctx, 'canvas_folders');
  }

  canSelect<TReturn>(query: Query<'canvas_folders', Schema, TReturn>): Query<'canvas_folders', Schema, TReturn> {
    return query.whereExists('createdByUser', u =>
      u.where('workspaceId', '=', this.ctx.workspaceId),
    );
  }
}
