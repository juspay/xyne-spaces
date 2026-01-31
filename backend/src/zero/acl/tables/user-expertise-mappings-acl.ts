import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class UserExpertiseMappingsACL extends BaseACL<'user_expertise_mappings'> {

  async canInsert(args: InsertValue<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    // Only group members can set expertise
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User expertise mapping insert failed: you must be a group member', 'user_expertise_mappings');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User expertise mapping update failed: mapping does not exist', 'user_expertise_mappings');
    }

    // Only group members can update
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', mapping.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User expertise mapping update failed: you must be a group member', 'user_expertise_mappings');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'user_expertise_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const mapping = await tx.run(zql.user_expertise_mappings.where('id', args.id).one());
    
    if (!mapping) {
      throw new MutationACLError('User expertise mapping delete failed: mapping does not exist', 'user_expertise_mappings');
    }

    // Only group members can delete
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', mapping.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User expertise mapping delete failed: you must be a group member', 'user_expertise_mappings');
    }
  }

  async canUpsert(args: any, tx: Transaction<Schema>): Promise<void> {
    // Only group members can upsert
    const membership = await tx.run(
      zql.user_group_mappings
        .where('userGroupId', args.userGroupId)
        .where('userId', this.ctx.userID)
        .one()
    );
    
    if (!membership) {
      throw new MutationACLError('User expertise mapping upsert failed: you must be a group member', 'user_expertise_mappings');
    }
  }
}
