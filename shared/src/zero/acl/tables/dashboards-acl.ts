import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { DashboardVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import type { SelectArgs } from '../core/types';

export class DashboardsACL extends BaseQueryACL<'dashboards'> {
  constructor(ctx: Context) {
    super(ctx, 'dashboards');
  }

  canSelect<TReturn>(
    query: Query<'dashboards', Schema, TReturn>,
    args?: SelectArgs,
  ): Query<'dashboards', Schema, TReturn> {
    query = query.where('workspaceId', '=', this.ctx.workspaceId);

    if (args?.isParticipant === true) {
      return query.whereExists(
        'participants',
        p => p.where('userId', this.ctx.userID),
        { scalar: true },
      );
    }

    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('createdBy', this.ctx.userID),
        cmp('visibility', DashboardVisibility.PUBLIC),
        exists('participants', p => p.where('userId', this.ctx.userID), { scalar: true }),
      ),
    );
  }
}
