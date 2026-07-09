import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class RecurringCallParticipantsACL extends BaseQueryACL<'recurring_call_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'recurring_call_participants');
  }

  canSelect<TReturn>(
    query: Query<'recurring_call_participants', Schema, TReturn>,
  ): Query<'recurring_call_participants', Schema, TReturn> {
    return query.whereExists('recurringSeries', series =>
      series.where(({ or, exists, cmp }) =>
        or(
          cmp('organizerId', this.ctx.userID),
          exists('channel', channel =>
            channel
              .where('workspaceId', '=', this.ctx.workspaceId)
              .whereExists('participants', participant =>
                participant.where('userId', this.ctx.userID),
              ),
          ),
        ),
      ),
    );
  }
}
