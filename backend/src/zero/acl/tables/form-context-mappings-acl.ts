import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class FormContextMappingsACL extends BaseACL<'forms_context_mapping'> {

  private async verifyFormInWorkspace(formId: string, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', formId).one());
    if (!form) {
      throw new MutationACLError('Form context mapping not found: form does not exist', 'forms_context_mapping');
    }
    // Direct workspaceId check - no user lookup needed
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form context mapping not found in this workspace', 'forms_context_mapping');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'forms_context_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    await this.verifyFormInWorkspace(args.formId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'forms_context_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.forms_context_mapping.where('id', args.id).one());
    if (!mapping) {
      throw new MutationACLError('Form context mapping update failed: record does not exist', 'forms_context_mapping');
    }
    await this.verifyFormInWorkspace(mapping.formId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'forms_context_mapping'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.forms_context_mapping.where('id', args.id).one());
    if (!mapping) {
      throw new MutationACLError('Form context mapping delete failed: record does not exist', 'forms_context_mapping');
    }
    await this.verifyFormInWorkspace(mapping.formId, tx);
  }
}
