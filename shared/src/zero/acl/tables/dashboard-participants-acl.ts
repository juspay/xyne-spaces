import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class DashboardParticipantsACL extends BaseQueryACL<'dashboard_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'dashboard_participants');
  }

  canSelect<TReturn>(
    query: Query<'dashboard_participants', Schema, TReturn>,
  ): Query<'dashboard_participants', Schema, TReturn> {
    return query.where(({ exists, cmp, or }) =>
      or(
        cmp('userId', this.ctx.userID),
        exists('dashboard', (d) =>
          d.where(({ or, exists, cmp }) =>
            or(
              cmp('createdBy', this.ctx.userID),
              exists('participants', (p) => p.where('userId', this.ctx.userID)),
            ),
          ),
        ),
      ),
    );
  }
}
