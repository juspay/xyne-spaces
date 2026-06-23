import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { AccessType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

const FORMS_RESOURCE_NAME = 'FORMS';

export class FormFieldsACL extends BaseACL<'form_fields'> {

  /**
   * Check if user has ADMIN access to FORMS resource (direct or via group).
   */
  private async hasFormsAdminAccess(tx: Transaction<Schema>): Promise<boolean> {
    const formsResource = await tx.run(zql.resources.where('name', FORMS_RESOURCE_NAME).one());
    if (!formsResource) return false;

    // Direct user grants on the resource
    const directGrants = await tx.run(
      zql.resource_access
        .where('userId', this.ctx.userID)
        .where('resourceId', formsResource.id),
    );
    if (directGrants.some(g => g.accessType === AccessType.ADMIN)) return true;

    // Group grants: find user's group memberships, then check group access
    const memberships = await tx.run(
      zql.user_group_mappings.where('userId', this.ctx.userID),
    );
    const groupIds = new Set(memberships.map(m => m.userGroupId));
    const groupGrants = await tx.run(
      zql.resource_access.where('resourceId', formsResource.id),
    );
    return groupGrants.some(
      g => g.groupId != null && groupIds.has(g.groupId) && g.accessType === AccessType.ADMIN,
    );
  }

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
    // Allow FORMS resource ADMIN to insert form fields
    if (await this.hasFormsAdminAccess(tx)) {
      return;
    }
    await this.verifyFormInWorkspace(args.formId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'form_fields'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow FORMS resource ADMIN to update any form field
    if (await this.hasFormsAdminAccess(tx)) {
      return;
    }
    const field = await tx.run(zql.form_fields.where('id', args.id).one());
    if (!field) {
      throw new MutationACLError('Form field update failed: field does not exist', 'form_fields');
    }
    await this.verifyFormInWorkspace(field.formId, tx);
  }

  async canDelete(args: DeleteID<TableSchema<'form_fields'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow FORMS resource ADMIN to delete any form field
    if (await this.hasFormsAdminAccess(tx)) {
      return;
    }
    const field = await tx.run(zql.form_fields.where('id', args.id).one());
    if (!field) {
      throw new MutationACLError('Form field delete failed: field does not exist', 'form_fields');
    }
    await this.verifyFormInWorkspace(field.formId, tx);
  }
}
