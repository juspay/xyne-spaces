import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ActivitiesACL extends BaseACL<'activities'> {

  async canInsert(_args: InsertValue<TableSchema<'activities'>>, _tx: Transaction<Schema>): Promise<void> {
    //Any user can insert activity for any other user
  }

  async canUpdate(args: UpdateValue<TableSchema<'activities'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.isRead) {
      const activity = await tx.run(zql.activities.where('id', '=', args.id).where('userId', this.ctx.userID).one());
      if (activity) {
        return;
      }
      throw new MutationACLError('Activity update failed: you can only update activities assigned to you', 'activities');
    }

    throw new MutationACLError('Activity update failed: only the isRead field can be modified', 'activities');
  }

  async canDelete(_args: DeleteID<TableSchema<'activities'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Activity delete failed: activities are immutable audit records and cannot be deleted', 'activities');
  }
}
