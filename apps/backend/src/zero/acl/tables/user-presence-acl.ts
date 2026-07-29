import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class UserPresenceACL extends BaseACL<'user_presence'> {

  async canInsert(_args: InsertValue<TableSchema<'user_presence'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User presence insert failed: User presence is api based, Not allowed via zero', 'user_presence');
  }

  async canUpdate(args: UpdateValue<TableSchema<'user_presence'>>, tx: Transaction<Schema>): Promise<void> {
    const presence = await tx.run(zql.user_presence.where('id', args.id).one());
    if (!presence) {
      throw new MutationACLError('User presence update failed: presence record does not exist', 'user_presence');
    }
    if (presence.userId !== this.ctx.userID) {
      throw new MutationACLError('User presence update failed: you can only update your own presence', 'user_presence');
    }
  }

  async canDelete(_args: DeleteID<TableSchema<'user_presence'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('User presence delete failed: presence is system-managed and cannot be deleted directly', 'user_presence');
  }

  async canUpsert(args: UpsertValue<TableSchema<'user_presence'>>, tx: Transaction<Schema>): Promise<void> {
    const presence = await tx.run(zql.user_presence.where('id', args.id).one());
    if (presence) {
      await this.canUpdate(args, tx);
    } else {
      await this.canInsert(args, tx);
    }
  }
  
}
