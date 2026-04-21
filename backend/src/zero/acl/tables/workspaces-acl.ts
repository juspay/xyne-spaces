import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { verifyWorkspaceAdminOrOwnerFromContext } from '../core/admin-access';

/**
 * Workspaces ACL
 * Controls access to workspace operations
 * Only ADMIN or OWNER roles can modify workspace settings
 */
export class WorkspacesACL extends BaseACL<'workspaces'> {

  async canInsert(_args: InsertValue<TableSchema<'workspaces'>>, _tx: Transaction<Schema>): Promise<void> {
    // Workspace creation is handled through auth/organization flow, not direct mutation
    throw new MutationACLError(
      'Workspace insert failed: workspaces are created through organization flow',
      'workspaces'
    );
  }

  async canUpdate(args: UpdateValue<TableSchema<'workspaces'>>, _tx: Transaction<Schema>): Promise<void> {
    // Security check: workspaceId must match context
    if (this.ctx.workspaceId && this.ctx.workspaceId !== args.id) {
      throw new MutationACLError(
        'Workspace update failed: workspace ID mismatch',
        'workspaces'
      );
    }

    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'workspaces');

    // Additional check: prevent changing critical fields like orgId
    if (args.orgId !== undefined) {
      throw new MutationACLError(
        'Workspace update failed: cannot change organization association',
        'workspaces'
      );
    }
  }

  async canDelete(args: DeleteID<TableSchema<'workspaces'>>, _tx: Transaction<Schema>): Promise<void> {
    // Security check: workspaceId must match context
    if (this.ctx.workspaceId && this.ctx.workspaceId !== args.id) {
      throw new MutationACLError(
        'Workspace delete failed: workspace ID mismatch',
        'workspaces'
      );
    }

    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'workspaces');

    throw new MutationACLError(
      'Workspace delete failed: workspaces cannot be deleted directly',
      'workspaces'
    );
  }
}
