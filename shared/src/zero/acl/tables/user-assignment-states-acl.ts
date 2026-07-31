import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserAssignmentStatesACL extends BaseQueryACL<'user_assignment_states'> {
  constructor(ctx: Context) {
    super(ctx, 'user_assignment_states');
  }

  canSelect<TReturn>(
    query: Query<'user_assignment_states', Schema, TReturn>,
  ): Query<'user_assignment_states', Schema, TReturn> {
    return query.whereExists('userGroup', (ug) => ug.where('workspaceId', '=', this.ctx.workspaceId));
  }
}
