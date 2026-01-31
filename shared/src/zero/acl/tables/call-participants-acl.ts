import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class CallParticipantsACL extends BaseQueryACL<'call_participants'> {
  constructor(ctx: Context) {
    super(ctx, 'call_participants');
  }

  canSelect<TReturn>(query: Query<'call_participants', Schema, TReturn>): Query<'call_participants', Schema, TReturn> {
    return query.where(({ exists }) =>
      exists('call', (call) =>
        call.where(({ or, exists, cmp }) =>
          or(
            cmp('createdByUserId', this.ctx.userID),
            exists('participants', (p) => p.where('userId', this.ctx.userID)),
            exists('channel', (ch) =>
              ch
                .where('visibility', '=', ChannelVisibility.PUBLIC)
                .whereExists('participants', (p) => p.where('userId', this.ctx.userID))
            )
          )
        )
      )
    );
  }
}
