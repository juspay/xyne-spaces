import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { OrgRole, Schema, WorkspaceRole } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { assertGuestWriteBlocked } from '../core/guest-access';

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

  /**
   * Bind the action to the caller's OWN organization.
   *
   * QueryContext carries orgRole but NOT the caller's orgId, so an ADMIN/OWNER role
   * check alone does not prove the target member lives in the caller's org. Without
   * this, an admin of org A can update/delete/insert members of org B (cross-org
   * privilege escalation). Resolve the caller's active membership from ctx.memberId
   * and require the target org to match.
   */
  private async assertActorInOrg(targetOrgId: string, tx: Transaction<Schema>): Promise<void> {
    const self = await tx.run(
      zql.org_members
        .where('memberId', this.ctx.memberId)
        .where('leftAt', 'IS', null)
        .one(),
    );
    if (!self || self.orgId !== targetOrgId) {
      throw new MutationACLError(
        'Organization member operation failed: target member belongs to a different organization',
        'org_members',
      );
    }
  }

  // NOTE: read-then-check, not atomic — two concurrent demote/remove requests can
  // both observe count == 2 and both proceed, leaving zero admins. Same pattern as
  // UsersACL.verifyLastAdmin (not new to this ACL). A real fix needs a DB-level
  // constraint or advisory lock; not done here.
  private async verifyLastAdmin(orgId: string, tx: Transaction<Schema>, errorMessage: string): Promise<void> {
    const adminCount = await tx.run(
      zql.org_members
        .where('orgId', orgId)
        .where('role', OrgRole.ADMIN)
        .where('leftAt', 'IS', null)
    );
    const ownerCount = await tx.run(
      zql.org_members
        .where('orgId', orgId)
        .where('role', OrgRole.OWNER)
        .where('leftAt', 'IS', null)
    );
    const totalAdmins = adminCount.length + ownerCount.length;
    if (totalAdmins <= 1) {
      throw new MutationACLError(errorMessage, 'org_members');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Organization member insert failed: community members cannot add organization members', 'org_members');
    }

    assertGuestWriteBlocked(this.ctx, 'org_members', 'insert', 'Organization member');
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

    // An admin/owner may only add members to their OWN org, never inject a member
    // into another organization.
    await this.assertActorInOrg(args.orgId, tx);

    // One-org-per-email constraint
    const existingMembership = await tx.run(
      zql.org_members.where('email', args.email).where('leftAt', 'IS', null).one(),
    );
    if (existingMembership && existingMembership.orgId !== args.orgId) {
      throw new MutationACLError('Organization member insert failed: this email already belongs to another organization', 'org_members');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Organization member update failed: community members cannot modify member roles', 'org_members');
    }
    assertGuestWriteBlocked(this.ctx, 'org_members', 'update', 'Organization member');
    const targetMember = await tx.run(zql.org_members.where('memberId', args.memberId).one());
    if (!targetMember) {
      throw new MutationACLError('Organization member update failed: the member does not exist', 'org_members');
    }

    // Users can update themselves, but cannot change their own role
    if (targetMember.memberId === this.ctx.memberId) {
      if (args.role !== undefined && args.role !== targetMember.role) {
        throw new MutationACLError('Organization member update failed: you cannot change your own role', 'org_members');
      }
      return;
    }

    // Only ADMIN or OWNER can update others
    if (!this.isAdminOrOwner()) {
      throw new MutationACLError('Organization member update failed: only admins or owners can modify member roles', 'org_members');
    }

    // Admin/owner authority is scoped to the caller's OWN org — reject cross-org edits.
    await this.assertActorInOrg(targetMember.orgId, tx);

    // Only an OWNER can mint another OWNER — an ADMIN can promote/demote at ADMIN
    // level but shouldn't be able to hand out ownership.
    if (args.role === OrgRole.OWNER && this.ctx.orgRole !== OrgRole.OWNER) {
      throw new MutationACLError('Organization member update failed: only owners can assign the owner role', 'org_members');
    }

    // Check "last admin" constraint when demoting an admin/owner
    if (
      args.role !== undefined &&
      args.role !== OrgRole.ADMIN &&
      args.role !== OrgRole.OWNER &&
      (targetMember.role === OrgRole.ADMIN || targetMember.role === OrgRole.OWNER)
    ) {
      await this.verifyLastAdmin(targetMember.orgId, tx, 'Organization member update failed: cannot demote the only admin');
    }

    // Check "last admin" constraint when removing (soft-delete via leftAt) an admin/owner.
    // `orgMember.remove` sets leftAt through an update, not a delete, so this must live
    // here — canDelete never runs for that path.
    if (
      args.leftAt !== undefined &&
      args.leftAt !== null &&
      (targetMember.role === OrgRole.ADMIN || targetMember.role === OrgRole.OWNER)
    ) {
      await this.verifyLastAdmin(targetMember.orgId, tx, 'Organization member update failed: cannot remove the only admin');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    if (this.ctx.role === WorkspaceRole.COMMUNITY_MEMBER) {
      throw new MutationACLError('Organization member delete failed: community members cannot remove members', 'org_members');
    }
    assertGuestWriteBlocked(this.ctx, 'org_members', 'delete', 'Organization member');
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

    // Admin/owner authority is scoped to the caller's OWN org — reject cross-org deletes.
    await this.assertActorInOrg(memberData.orgId, tx);

    // Defensive: no mutator currently issues a hard delete (org_members uses the
    // leftAt soft-delete via canUpdate above), but guard it the same way in case
    // that changes.
    if (memberData.role === OrgRole.ADMIN || memberData.role === OrgRole.OWNER) {
      await this.verifyLastAdmin(memberData.orgId, tx, 'Organization member delete failed: cannot remove the only admin');
    }
  }
}
