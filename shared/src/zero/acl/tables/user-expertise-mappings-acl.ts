import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class UserExpertiseMappingsACL extends BaseQueryACL<'user_expertise_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'user_expertise_mappings');
  }

  canSelect<TReturn>(
    query: Query<'user_expertise_mappings', Schema, TReturn>,
  ): Query<'user_expertise_mappings', Schema, TReturn> {
    return query.whereExists('userGroup', (ug) => ug.where('workspaceId', '=', this.ctx.workspaceId));
  }
}
