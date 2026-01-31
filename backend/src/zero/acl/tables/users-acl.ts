import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';

export class UsersACL extends BaseACL<'users'> {

  async canInsert(_args: InsertValue<TableSchema<'users'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User insert failed: users are created through authentication and cannot be inserted directly', 'users');
  }

  async canUpdate(args: UpdateValue<TableSchema<'users'>>, _tx: Transaction<Schema>): Promise<void> {
    if (args.id !== this.ctx.userID) {
      throw new MutationACLError('User update failed: you can only modify your own profile', 'users');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'users'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User delete failed: users cannot be deleted directly, use account deactivation instead', 'users');
  }
}
