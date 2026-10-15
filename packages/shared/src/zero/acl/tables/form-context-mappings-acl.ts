import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class FormContextMappingsACL extends BaseQueryACL<'forms_context_mapping'> {
  constructor(ctx: Context) {
    super(ctx, 'forms_context_mapping');
  }

  canSelect<TReturn>(
    query: Query<'forms_context_mapping', Schema, TReturn>
  ): Query<'forms_context_mapping', Schema, TReturn> {
    // Direct workspaceId check through form - no need to traverse through createdByUser
    return query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
