import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

export class ChannelBoardMappingsACL extends BaseACL<'channel_board_mappings'> {
  async canInsert(
    args: InsertValue<TableSchema<'channel_board_mappings'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Channel-board mapping insert failed: workspace mismatch',
        'channel_board_mappings',
      );
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'channel_board_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.verifyMappingWorkspace(args.id, tx, 'update');
  }

  async canDelete(
    args: DeleteID<TableSchema<'channel_board_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    await this.verifyMappingWorkspace(args.id, tx, 'delete');
  }

  private async verifyMappingWorkspace(
    id: string,
    tx: Transaction<Schema>,
    operation: 'update' | 'delete',
  ): Promise<void> {
    const mapping = await tx.run(zql.channel_board_mappings.where('id', id).one());
    if (!mapping || mapping.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        `Channel-board mapping ${operation} failed: mapping not found in this workspace`,
        'channel_board_mappings',
      );
    }
  }
}
