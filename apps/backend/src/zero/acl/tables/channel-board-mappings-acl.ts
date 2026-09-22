import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, ChannelScopeType, type Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { hasProjectAdminAccess } from '../core/admin-access';
import { zql } from '../../queries';

/**
 * Per-transaction memo for the checks that don't vary per row.
 *
 * Linking is a batch operation (up to 100 boards), and the transaction wrapper
 * runs canInsert on EVERY insert with a fresh ACL instance — so without this the
 * channel, participant and projects-admin lookups repeat once per board, holding
 * the write transaction open for hundreds of reads.
 *
 * Keyed on the Transaction object, so entries die with the transaction and an
 * authorization decision can never be reused across requests.
 */
const txMemo = new WeakMap<object, Map<string, Promise<unknown>>>();

function memoizeForTx<T>(
  tx: Transaction<Schema>,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  let perTx = txMemo.get(tx as unknown as object);
  if (!perTx) {
    perTx = new Map();
    txMemo.set(tx as unknown as object, perTx);
  }
  const cached = perTx.get(key);
  if (cached) return cached as Promise<T>;
  const pending = compute();
  perTx.set(key, pending);
  return pending;
}

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

    const channel = await memoizeForTx(tx, `channel:${args.channelId}`, () =>
      tx.run(zql.channels.where('id', args.channelId).one()),
    );
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
    // admins, who administer boards across the workspace. Both are per-user, not
    // per-board, so they resolve once per transaction.
    if (await this.isChannelAdmin(args.channelId, tx)) {
      return;
    }
    const isProjectAdmin = await memoizeForTx(tx, `projectAdmin:${this.ctx.userID}`, () =>
      hasProjectAdminAccess(this.ctx, tx),
    );
    if (isProjectAdmin) {
      return;
    }
    throw new MutationACLError(
      'Channel-board mapping insert failed: only a channel admin or a projects admin can link boards',
      'channel_board_mappings',
    );
  }

  private async isChannelAdmin(channelId: string, tx: Transaction<Schema>): Promise<boolean> {
    const participant = await memoizeForTx(
      tx,
      `participant:${channelId}:${this.ctx.userID}`,
      () =>
        tx.run(
          zql.channel_participants
            .where('channelId', channelId)
            .where('userId', this.ctx.userID)
            .one(),
        ),
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
