import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { zql } from '../../queries';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { verifyWorkspaceAdminOrOwnerFromContext } from '../core/admin-access';

/**
 * Invitations ACL
 * Controls access to invitation operations
 */
export class InvitationsACL extends BaseACL<'invitations'> {

  async canInsert(_args: InsertValue<TableSchema<'invitations'>>, _tx: Transaction<Schema>): Promise<void> {
    // Security check: workspaceId must match context
    if (this.ctx.workspaceId && this.ctx.workspaceId !== _args.workspaceId) {
      throw new MutationACLError(
        'Invitation insert failed: workspace ID mismatch',
        'invitations'
      );
    }

    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'invitations');
  }

  async canUpdate(args: UpdateValue<TableSchema<'invitations'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the invitation to check its workspace
    const invitation = await tx.run(zql.invitations.where('id', args.id).one());
    if (!invitation) {
      throw new MutationACLError('Invitation update failed: invitation not found', 'invitations');
    }

    // Security check: workspaceId must match context
    if (this.ctx.workspaceId && this.ctx.workspaceId !== invitation.workspaceId) {
      throw new MutationACLError(
        'Invitation update failed: workspace ID mismatch',
        'invitations'
      );
    }

    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'invitations');
  }

  async canDelete(args: DeleteID<TableSchema<'invitations'>>, tx: Transaction<Schema>): Promise<void> {
    // Get the invitation to check its workspace
    const invitation = await tx.run(zql.invitations.where('id', args.id).one());
    if (!invitation) {
      throw new MutationACLError('Invitation delete failed: invitation not found', 'invitations');
    }

    // Security check: workspaceId must match context
    if (this.ctx.workspaceId && this.ctx.workspaceId !== invitation.workspaceId) {
      throw new MutationACLError(
        'Invitation delete failed: workspace ID mismatch',
        'invitations'
      );
    }

    // Verify user has ADMIN or OWNER role (uses ctx.role, no DB query)
    verifyWorkspaceAdminOrOwnerFromContext(this.ctx, 'invitations');
  }
}
