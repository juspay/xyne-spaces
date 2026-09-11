import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ActivitiesACL extends BaseACL<'activities'> {

  private async verifyWorkspace(userId: string, tx: Transaction<Schema>): Promise<void> {
    const user = await tx.run(zql.users.where('id', userId).one());
    if (!user || user.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Activity not found in this workspace', 'activities');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'activities'>>, tx: Transaction<Schema>): Promise<void> {
    // Any member may raise an activity for any other member — one person's action is what
    // puts a row in someone else's feed. The workspace is the bound: the row must name the
    // caller's own, and the member it is about has to belong to it.
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Activity insert failed: wrong workspace', 'activities');
    }
    await this.verifyWorkspace(args.userId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'activities'>>, tx: Transaction<Schema>): Promise<void> {
    if (args.isRead !== undefined) {
      const activity = await tx.run(zql.activities.where('id', '=', args.id).where('userId', this.ctx.userID).one());
      if (activity) {
        await this.verifyWorkspace(activity.userId, tx);
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
