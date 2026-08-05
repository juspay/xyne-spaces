import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class StageApproversACL extends BaseQueryACL<'stage_approvers'> {
  constructor(ctx: Context) {
    super(ctx, 'stage_approvers');
  }

  canSelect<TReturn>(query: Query<'stage_approvers', Schema, TReturn>): Query<'stage_approvers', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
