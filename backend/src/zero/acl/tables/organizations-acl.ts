import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { OrgRole, Schema, WorkspaceRole } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

/**
 * Organizations ACL
 * Controls access to organization operations
 * Uses ctx.orgRole for fast role checks (no DB traversal needed)
 */
export class OrganizationsACL extends BaseACL<'organizations'> {

  /**
   * Check if the current user has ADMIN or OWNER role using context
   * Fast check - no DB query needed
   */
  private isAdminOrOwner(): boolean {
    return this.ctx.orgRole === OrgRole.ADMIN || this.ctx.orgRole === OrgRole.OWNER;
  }

  async canInsert(_args: InsertValue<TableSchema<'organizations'>>, _tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Organization insert failed: community members cannot create organizations', 'organizations');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'organizations'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Organization update failed: community members cannot modify organizations', 'organizations');
    }
    const org = await tx.run(zql.organizations.where('orgId', args.orgId).one());
    if (org && org.createdBy === this.ctx.userID) {
      return;
    }

    if (!this.isAdminOrOwner()) {
      throw new MutationACLError('Organization update failed: only admins, owners, or creator can modify settings', 'organizations');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'organizations'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Organization delete failed: community members cannot delete organizations', 'organizations');
    }
    const org = await tx.run(zql.organizations.where('orgId', args.orgId).one());
    if (org && org.createdBy === this.ctx.userID) {
      return;
    }

    // ADMIN or OWNER can delete
    if (!this.isAdminOrOwner()) {
      throw new MutationACLError('Organization delete failed: only admins, owners, or creator can delete', 'organizations');
    }
  }
}
