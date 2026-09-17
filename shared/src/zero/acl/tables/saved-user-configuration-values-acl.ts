import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class SavedUserConfigurationValuesACL extends BaseQueryACL<'saved_user_configuration_values'> {
  constructor(ctx: Context) {
    super(ctx, 'saved_user_configuration_values');
  }

  canSelect<TReturn>(query: Query<'saved_user_configuration_values', Schema, TReturn>): Query<'saved_user_configuration_values', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
