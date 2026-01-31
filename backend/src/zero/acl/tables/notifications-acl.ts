import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';

export class NotificationsACL extends BaseACL<'notifications'> {

  async canInsert(_args: InsertValue<TableSchema<'notifications'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Notification insert failed: notifications are system-managed and cannot be created directly', 'notifications');
  }

  async canUpdate(_args: UpdateValue<TableSchema<'notifications'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Notification update failed: notifications are system-managed and cannot be modified directly', 'notifications');
  }

  async canDelete(_args: DeleteID<TableSchema<'notifications'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Notification delete failed: notifications are system-managed and cannot be deleted directly', 'notifications');
  }
}
