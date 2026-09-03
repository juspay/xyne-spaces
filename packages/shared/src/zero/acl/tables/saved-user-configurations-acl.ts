import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { SavedConfigVisibility, ViewAccessEntityType } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SavedUserConfigurationsACL extends BaseQueryACL<'saved_user_configurations'> {
  constructor(ctx: Context) {
    super(ctx, 'saved_user_configurations');
  }

  canSelect<TReturn>(
    query: Query<'saved_user_configurations', Schema, TReturn>,
  ): Query<'saved_user_configurations', Schema, TReturn> {
    return query.where(({ or, and, cmp, exists }) =>
      or(
        cmp('userId', '=', this.ctx.userID),
        cmp('visibility', '=', SavedConfigVisibility.PUBLIC),
        exists('viewAccess', (va) =>
          va
            .where('entityType', ViewAccessEntityType.USER)
            .where('entityId', this.ctx.userID),
        ),
      ),
    );
  }
}
