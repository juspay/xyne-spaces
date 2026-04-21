import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class FormFieldsACL extends BaseACL<'form_fields'> {

  private async verifyFormInWorkspace(formId: string, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', formId).one());
    if (!form) {
      throw new MutationACLError('Form field not found: form does not exist', 'form_fields');
    }
    // Direct workspaceId check - no user lookup needed
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form field not found in this workspace', 'form_fields');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'form_fields'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyFormInWorkspace(args.formId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'form_fields'>>, tx: Transaction<Schema>): Promise<void> {
    const field = await tx.run(zql.form_fields.where('id', args.id).one());
    if (!field) {
      throw new MutationACLError('Form field update failed: field does not exist', 'form_fields');
    }
    await this.verifyFormInWorkspace(field.formId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'form_fields'>>, tx: Transaction<Schema>): Promise<void> {
    const field = await tx.run(zql.form_fields.where('id', args.id).one());
    if (!field) {
      throw new MutationACLError('Form field delete failed: field does not exist', 'form_fields');
    }
    await this.verifyFormInWorkspace(field.formId, tx);
  }
}
