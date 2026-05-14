import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class FormsACL extends BaseACL<'forms'> {

  async canInsert(args: InsertValue<TableSchema<'forms'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Form insert failed: createdBy must match the current user', 'forms');
    }
    // Direct workspaceId check - no user lookup needed
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form insert failed: workspace ID mismatch', 'forms');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'forms'>>, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', args.id).one());
    if (!form) {
      throw new MutationACLError('Form update failed: form does not exist', 'forms');
    }
    // Direct workspaceId check - no user lookup needed
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form update failed: workspace ID mismatch', 'forms');
    }
    // Allow OWNER and ADMIN roles to update any form in their workspace
    if (this.ctx.orgRole === 'OWNER' || this.ctx.orgRole === 'ADMIN') {
      return;
    }
    if (form.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Form update failed: only the creator can update this form', 'forms');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'forms'>>, tx: Transaction<Schema>): Promise<void> {
    const form = await tx.run(zql.forms.where('id', args.id).one());
    if (!form) {
      throw new MutationACLError('Form delete failed: form does not exist', 'forms');
    }
    // Direct workspaceId check - no user lookup needed
    if (form.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Form delete failed: workspace ID mismatch', 'forms');
    }
    // Allow OWNER and ADMIN roles to delete any form in their workspace
    if (this.ctx.orgRole === 'OWNER' || this.ctx.orgRole === 'ADMIN') {
      return;
    }
    if (form.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Form delete failed: only the creator can delete this form', 'forms');
    }
  }
}
