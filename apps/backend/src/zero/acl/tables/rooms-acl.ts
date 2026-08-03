import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { assertProjectWritable, getRoomInWorkspace, requireRoomManager } from './room-acl-helpers';

export class RoomsACL extends BaseACL<'rooms'> {
  async canInsert(args: InsertValue<TableSchema<'rooms'>>, tx: Transaction<Schema>): Promise<void> {
    await assertProjectWritable(args.projectId, this.ctx, tx, 'rooms');
  }

  async canUpdate(args: UpdateValue<TableSchema<'rooms'>>, tx: Transaction<Schema>): Promise<void> {
    const room = await getRoomInWorkspace(args.id, this.ctx, tx, 'rooms');
    if (args.projectId !== undefined && args.projectId !== room.projectId) {
      throw new MutationACLError('Room update failed: project cannot be changed', 'rooms');
    }
    await requireRoomManager(room, this.ctx, tx, 'rooms');
  }

  async canDelete(_args: DeleteID<TableSchema<'rooms'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Room delete failed: rooms are archived, never hard-deleted', 'rooms');
  }
}
