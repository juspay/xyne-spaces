import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema, WorkspaceRole } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { verifyWorkspaceAdminOrOwnerFromContext } from '../core/admin-access';

/**
 * Workspace Organizations ACL
 * Controls access to workspace_organizations operations
 * Only ADMIN or OWNER roles can modify workspace organization links
 */
export class WorkspaceOrganizationsACL extends BaseACL<'workspace_organizations'> {

  async canInsert(_args: InsertValue<TableSchema<'workspace_organizations'>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Workspace organization insert failed: community members cannot link workspaces to organizations', 'workspace_organizations');
    }
    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'workspace_organizations');

    // Workspace-organization linking is handled through organization flow
    throw new MutationACLError(
      'Workspace organization insert failed: links are created through organization flow',
      'workspace_organizations'
    );
  }

  async canUpdate(args: UpdateValue<TableSchema<'workspace_organizations'>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Workspace organization update failed: community members cannot modify workspace organization links', 'workspace_organizations');
    }
    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'workspace_organizations');

    // Security check: workspaceId must match context
    if (this.ctx.workspaceId && this.ctx.workspaceId !== args.workspaceId) {
      throw new MutationACLError(
        'Workspace organization update failed: workspace ID mismatch',
        'workspace_organizations'
      );
    }

    // Prevent changing critical fields
    if (args.orgId !== undefined || args.workspaceId !== undefined) {
      throw new MutationACLError(
        'Workspace organization update failed: cannot change organization or workspace association',
        'workspace_organizations'
      );
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'workspace_organizations'>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Workspace organization delete failed: community members cannot delete workspace organization links', 'workspace_organizations');
    }
    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'workspace_organizations');

    throw new MutationACLError(
      'Workspace organization delete failed: links cannot be deleted directly',
      'workspace_organizations'
    );
  }
}
