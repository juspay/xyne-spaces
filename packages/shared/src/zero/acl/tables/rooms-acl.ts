import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RoomsACL extends BaseQueryACL<'rooms'> {
  constructor(ctx: Context) {
    super(ctx, 'rooms');
  }

  canSelect<TReturn>(query: Query<'rooms', Schema, TReturn>): Query<'rooms', Schema, TReturn> {
    return query.whereExists('project', (project) =>
      project.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
