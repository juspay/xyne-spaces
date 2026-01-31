import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class OrganizationsACL extends BaseACL<'organizations'> {

  async canInsert(_args: InsertValue<TableSchema<'organizations'>>, _tx: Transaction<Schema>): Promise<void> {
    // Any user can create an organization
  }

  async canUpdate(args: UpdateValue<TableSchema<'organizations'>>, tx: Transaction<Schema>): Promise<void> {
    const createdByUserId = await tx.run(zql.organizations.where('orgId', args.orgId).one());
    if (createdByUserId && createdByUserId.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Organization update failed: only the organization creator can modify settings', 'organizations');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'organizations'>>, tx: Transaction<Schema>): Promise<void> {
     const createdByUserId = await tx.run(zql.organizations.where('orgId', args.orgId).one());
    if (createdByUserId && createdByUserId.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Organization delete failed: only the organization creator can delete it', 'organizations');
    }
  }
}
