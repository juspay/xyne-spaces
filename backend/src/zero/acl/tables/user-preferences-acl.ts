import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import {
  MutationACLError,
  type TableSchema,
} from '../core/types';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { zql } from '../../queries';

export class UserPreferencesACL extends BaseACL<'user_preferences'> {

  async canInsert(args: InsertValue<TableSchema<'user_preferences'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('User preferences insert failed: you can only create your own preferences', 'user_preferences');
    }
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_preferences'>>, tx: Transaction<Schema>): Promise<void> {
    const pref = await tx.run(zql.user_preferences.where('id', args.id).one());
    if (!pref) {
      throw new MutationACLError('User preferences update failed: record does not exist', 'user_preferences');
    }
    if (pref.userId !== this.ctx.userID) {
      throw new MutationACLError('User preferences update failed: you can only update your own preferences', 'user_preferences');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'user_preferences'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User preferences delete failed: preferences cannot be deleted', 'user_preferences');
  }
}
