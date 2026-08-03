import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';
import { assertSourceAttachable, getRoomInWorkspace, requireRoomManager } from './room-acl-helpers';

export class RoomSourcesACL extends BaseACL<'room_sources'> {
  async canInsert(
    args: InsertValue<TableSchema<'room_sources'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    if (args.addedBy !== this.ctx.userID) {
      throw new MutationACLError(
        'Room source insert failed: addedBy must be the authenticated user',
        'room_sources'
      );
    }
    const room = await getRoomInWorkspace(args.roomId, this.ctx, tx, 'room_sources');
    await requireRoomManager(room, this.ctx, tx, 'room_sources');
    await assertSourceAttachable(args.sourceId, this.ctx, tx, 'room_sources');
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'room_sources'>>,
    _tx: Transaction<Schema>
  ): Promise<void> {
    throw new MutationACLError(
      'Room source update failed: sources are immutable - remove and re-add',
      'room_sources'
    );
  }

  async canDelete(
    args: DeleteID<TableSchema<'room_sources'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    const source = await tx.run(zql.room_sources.where('id', '=', args.id).one());
    if (!source) {
      throw new MutationACLError(
        'Room source delete failed: source does not exist',
        'room_sources'
      );
    }
    const room = await getRoomInWorkspace(source.roomId, this.ctx, tx, 'room_sources');
    await requireRoomManager(room, this.ctx, tx, 'room_sources');
  }
}
