import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class ClassificationMappingsACL extends BaseQueryACL<'classification_mappings'> {
  constructor(ctx: Context) {
    super(ctx, 'classification_mappings');
  }

  canSelect<TReturn>(query: Query<'classification_mappings', Schema, TReturn>): Query<'classification_mappings', Schema, TReturn> {
    return query.where('workspaceId', '=', this.ctx.workspaceId);
  }
}
