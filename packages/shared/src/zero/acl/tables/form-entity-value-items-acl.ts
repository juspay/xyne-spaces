import type { Query } from '@rocicorp/zero';
import type { Schema, Context } from '../../schema';
import { BaseQueryACL } from '../core/base-acl';
import { FormEntityValuesACL } from './form-entity-values-acl';

export class FormEntityValueItemsACL extends BaseQueryACL<'form_entity_value_items'> {
  constructor(ctx: Context) {
    super(ctx, 'form_entity_value_items');
  }

  // An item is visible exactly when the form_entity_values row it belongs to is.
  canSelect<TReturn>(
    query: Query<'form_entity_value_items', Schema, TReturn>
  ): Query<'form_entity_value_items', Schema, TReturn> {
    const valuesACL = new FormEntityValuesACL(this.ctx);
    return query.whereExists('value', (value) => valuesACL.canSelect(value));
  }
}
