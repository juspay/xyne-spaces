import type { DeleteID, InsertValue, Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { MutationACLError, type TableSchema } from '../core/types';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';
import { FormEntityValuesACL } from './form-entity-values-acl';

// Items are written and removed together with their form_entity_values row, so each
// change is allowed exactly when the caller may update that row. Items are never updated.
export class FormEntityValueItemsACL extends BaseACL<'form_entity_value_items'> {

  private async verifyParentWritable(valueId: string, tx: Transaction<Schema>): Promise<void> {
    const value = await tx.run(zql.form_entity_values.where('id', valueId).one());
    if (!value) {
      throw new MutationACLError('Form entity value item failed: its form entity value does not exist', 'form_entity_value_items');
    }
    if (value.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form entity value item not found in this workspace', 'form_entity_value_items');
    }
    await new FormEntityValuesACL(this.ctx).canUpdate({ id: valueId }, tx);
  }

  async canInsert(args: InsertValue<TableSchema<'form_entity_value_items'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form entity value item insert failed: workspace mismatch', 'form_entity_value_items');
    }
    await this.verifyParentWritable(args.valueId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'form_entity_value_items'>>, tx: Transaction<Schema>): Promise<void> {
    const item = await tx.run(zql.form_entity_value_items.where('id', args.id).one());
    if (!item) {
      throw new MutationACLError('Form entity value item delete failed: record does not exist', 'form_entity_value_items');
    }
    await this.verifyParentWritable(item.valueId, tx);
  }
}
