import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { AccessType, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

const FORMS_RESOURCE_NAME = 'FORMS';

export class FormsACL extends BaseACL<'forms'> {

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
    // Allow FORMS resource ADMIN to update any form
    if (await this.hasFormsAdminAccess(tx)) {
      return;
    }
    // Otherwise, only creator can update
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
    // Allow FORMS resource ADMIN to delete any form
    if (await this.hasFormsAdminAccess(tx)) {
      return;
    }
    // Otherwise, only creator can delete
    if (form.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Form delete failed: only the creator can delete this form', 'forms');
    }
  }
}
