import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class NotificationPreferencesACL extends BaseACL<'notification_preferences'> {

  async canInsert(args: InsertValue<TableSchema<'notification_preferences'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('Notification preferences insert failed: you can only create preferences for yourself', 'notification_preferences');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'notification_preferences'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
        throw new MutationACLError('Notification preferences update failed: you can only modify your own preferences', 'notification_preferences');
    }
  }

  async canDelete(args: DeleteID<TableSchema<'notification_preferences'>>, tx: Transaction<Schema>): Promise<void> {
    const np = await tx.run(zql.notification_preferences.where('id', args.id).one())
    if (np?.userId !== this.ctx.userID) {
      throw new MutationACLError('Notification preferences delete failed: you can only delete your own preferences', 'notification_preferences');
    }
  }
}
