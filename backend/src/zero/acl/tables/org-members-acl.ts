import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { OrgRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

/**
 * Org Members ACL
 * Controls access to org_members operations
 * Uses ctx.orgRole for fast role checks (no DB traversal needed)
 */
export class OrgMembersACL extends BaseACL<'org_members'> {

  /**
   * Check if the current user has ADMIN or OWNER role using context
   * Fast check - no DB query needed
   */
  private isAdminOrOwner(): boolean {
    return this.ctx.orgRole === OrgRole.ADMIN || this.ctx.orgRole === OrgRole.OWNER;
  }

  async canInsert(args: InsertValue<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    // Allow organization's createdBy user to add themselves as OWNER (for org creation flow)
    if (args.email) {
      const currentUser = await tx.run(zql.users.where('id', this.ctx.userID).one());
      if (args.email === currentUser?.email && args.role === OrgRole.OWNER) {
        const org = await tx.run(zql.organizations.where('orgId', args.orgId).one());
        if (org && org.createdBy === this.ctx.userID) {
          return;
        }
      }
    }

    // Only ADMIN or OWNER can add members
    if (!this.isAdminOrOwner()) {
      throw new MutationACLError('Organization member insert failed: only admins or owners can add members', 'org_members');
    }

    // One-org-per-email constraint
    const existingMembership = await tx.run(
      zql.org_members.where('email', args.email).where('leftAt', 'IS', null).one(),
    );
    if (existingMembership && existingMembership.orgId !== args.orgId) {
      throw new MutationACLError('Organization member insert failed: this email already belongs to another organization', 'org_members');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    const targetMember = await tx.run(zql.org_members.where('memberId', args.memberId).one());
    if (!targetMember) {
      throw new MutationACLError('Organization member update failed: the member does not exist', 'org_members');
    }

    // Users can update themselves
    if (targetMember.memberId === this.ctx.memberId) {
      return;
    }

    // Only ADMIN or OWNER can update others
    if (!this.isAdminOrOwner()) {
      throw new MutationACLError('Organization member update failed: only admins or owners can modify member roles', 'org_members');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    const memberData = await tx.run(zql.org_members.where('memberId', args.memberId).one());
    if (!memberData) {
      throw new MutationACLError('Organization member delete failed: member not found', 'org_members');
    }

    // Users can remove themselves
    if (memberData.memberId === this.ctx.memberId) {
      return;
    }

    // Only ADMIN or OWNER can remove others
    if (!this.isAdminOrOwner()) {
      throw new MutationACLError('Organization member delete failed: only admins or owners can remove other members', 'org_members');
    }
  }
}
