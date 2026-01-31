import type { Query } from '@rocicorp/zero';
import { type Schema, type Context, ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class StagesACL extends BaseQueryACL<'stages'> {
  constructor(ctx: Context) {
    super(ctx, 'stages');
  }

  canSelect<TReturn>(query: Query<'stages', Schema, TReturn>): Query<'stages', Schema, TReturn> {
    return query.whereExists('board', (boardQuery) =>
      boardQuery.whereExists('project', (projectQuery) =>
        projectQuery.whereExists('channels', (channelQuery) =>
           channelQuery.where(({or, cmp, exists}) => {
            return or(
              cmp("visibility", ChannelVisibility.PUBLIC),
              exists("participants", participants => participants.where("userId", this.ctx.userID))
            )
          })
        )
      )
    );
  }
}
