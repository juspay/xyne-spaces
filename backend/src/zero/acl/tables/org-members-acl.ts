import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { OrgRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class OrgMembersACL extends BaseACL<'org_members'> {

  async canInsert(args: InsertValue<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    const memberData = await tx.run(zql.org_members.where('orgId', args.orgId).where('userId', this.ctx.userID).one());
    if (!memberData) {
      throw new MutationACLError('Organization member insert failed: you must be an organization member to add new members', 'org_members');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    const targetMember = await tx.run(zql.org_members.where('memberId', args.memberId).one());
    if (!targetMember) {
      throw new MutationACLError('Organization member update failed: the member does not exist', 'org_members');
    }
    
    const currentUserMemberData = await tx.run(zql.org_members.where('orgId', targetMember.orgId).where('userId', this.ctx.userID).one());
    if (!currentUserMemberData || currentUserMemberData.role === OrgRole.MEMBER || currentUserMemberData.role === OrgRole.VIEWER) {
      throw new MutationACLError('Organization member update failed: only admins or owners can modify member roles', 'org_members');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'org_members'>>, tx: Transaction<Schema>): Promise<void> {
    const memberData = await tx.run(zql.org_members.where('memberId', args.memberId).one());
    if (!memberData || memberData.userId !== this.ctx.userID) {
      throw new MutationACLError('Organization member delete failed: you can only remove yourself from an organization', 'org_members');
    }
  }
}
