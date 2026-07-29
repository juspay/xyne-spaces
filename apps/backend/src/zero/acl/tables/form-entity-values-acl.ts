import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class FormEntityValuesACL extends BaseACL<'form_entity_values'> {

  private async verifyWorkspace(formId: string, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', formId).one());
    if (!form) {
      throw new MutationACLError('Form entity value not found: form does not exist', 'form_entity_values');
    }
    // Direct workspaceId check - formId is now on form_entity_values, no need to lookup through form_fields
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form entity value not found in this workspace', 'form_entity_values');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'form_entity_values'>>, tx: Transaction<Schema>): Promise<void> {
    // Use args.formId directly - now available on form_entity_values
    await this.verifyWorkspace(args.formId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'form_entity_values'>>, tx: Transaction<Schema>): Promise<void> {
    const entityValue = await tx.run(zql.form_entity_values.where('id', args.id).one());
    if (!entityValue) {
      throw new MutationACLError('Form entity value update failed: record does not exist', 'form_entity_values');
    }
    // Use entityValue.formId directly
    await this.verifyWorkspace(entityValue.formId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'form_entity_values'>>, tx: Transaction<Schema>): Promise<void> {
    const entityValue = await tx.run(zql.form_entity_values.where('id', args.id).one());
    if (!entityValue) {
      throw new MutationACLError('Form entity value delete failed: record does not exist', 'form_entity_values');
    }
    // Use entityValue.formId directly
    await this.verifyWorkspace(entityValue.formId, tx);
  }
}
