import type { Query } from '@rocicorp/zero';
import { type Schema, type Context, ChannelVisibility } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
export class ProjectsACL extends BaseQueryACL<'projects'> {
  constructor(ctx: Context) {
    super(ctx, 'projects');
  }

  canSelect<TReturn>(query: Query<'projects', Schema, TReturn>): Query<'projects', Schema, TReturn> {
    return query.where(({ or, cmp, exists }) =>
      or(
        cmp('createdBy', this.ctx.userID),
        cmp('updatedBy', this.ctx.userID),
        exists('channels', (channelQuery) =>
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
