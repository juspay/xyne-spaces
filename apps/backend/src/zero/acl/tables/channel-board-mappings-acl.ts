import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, ChannelScopeType, type Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { hasProjectAdminAccess } from '../core/admin-access';
import { zql } from '../../queries';

export class ChannelBoardMappingsACL extends BaseACL<'channel_board_mappings'> {
  async canInsert(
    args: InsertValue<TableSchema<'channel_board_mappings'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Channel-board mapping insert failed: workspace mismatch',
        'channel_board_mappings',
      );
    }

    const channel = await tx.run(zql.channels.where('id', args.channelId).one());
    if (!channel) {
      throw new MutationACLError(
        'Channel-board mapping insert failed: channel does not exist',
        'channel_board_mappings',
      );
    }

    if (channel.scopeType !== ChannelScopeType.DEFAULT) {
      throw new MutationACLError(
        'Channel-board mapping insert failed: boards can only be linked to channels',
        'channel_board_mappings',
      );
    }

    if (channel.isArchived) {
      throw new MutationACLError(
        'Channel-board mapping insert failed: cannot link boards to an archived channel',
        'channel_board_mappings',
      );
    }

    // The board is addressed by a client-supplied id, so re-check its tenant here
    // rather than trusting the caller.
    const board = await tx.run(zql.boards.where('id', args.boardId).one());
    if (!board || board.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Channel-board mapping insert failed: board not found in this workspace',
        'channel_board_mappings',
      );
    }

    // Linking is open to a channel's own admins, and to LISTPROJECTS resource
    // admins, who administer boards across the workspace.
    if (await this.isChannelAdmin(args.channelId, tx)) {
      return;
    }
    if (await hasProjectAdminAccess(this.ctx, tx)) {
      return;
    }
    throw new MutationACLError(
      'Channel-board mapping insert failed: only a channel admin or a projects admin can link boards',
      'channel_board_mappings',
    );
  }

  private async isChannelAdmin(channelId: string, tx: Transaction<Schema>): Promise<boolean> {
    const participant = await tx.run(
      zql.channel_participants
        .where('channelId', channelId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    return participant?.role === ChannelRole.ADMIN;
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
