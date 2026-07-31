import type { Query } from '@rocicorp/zero';
import { type Schema, type Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';

export class FormEntityValuesACL extends BaseQueryACL<'form_entity_values'> {
  constructor(ctx: Context) {
    super(ctx, 'form_entity_values');
  }

  canSelect<TReturn>(
    query: Query<'form_entity_values', Schema, TReturn>
  ): Query<'form_entity_values', Schema, TReturn> {
    // Direct workspaceId check through form - formId is now on form_entity_values
    return query.whereExists('form', (f) =>
      f.where('workspaceId', '=', this.ctx.workspaceId)
    );
  }
}
