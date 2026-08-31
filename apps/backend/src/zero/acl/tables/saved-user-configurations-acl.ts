import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelRole, SavedConfigContextType, SavedConfigVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema, type QueryContext } from '../core/types';
import { zql } from '../../queries';

async function isChannelAdmin(
  tx: Transaction<Schema>,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const participant = await tx.run(
    zql.channel_participants
      .where('channelId', channelId)
      .where('userId', userId)
      .where('role', ChannelRole.ADMIN)
      .one(),
  );
  return !!participant;
}

/**
 * Checks if a user can create or promote a saved view to PUBLIC visibility.
 * Allowed if the user is:
 *   - The board creator
 *   - The project creator
 *   - An admin participant in any channel that maps to this board
 *     (via channel_board_mappings — channel.projectId is being deprecated
 *     as a read source)
 */
async function canMakePublicView(
  tx: Transaction<Schema>,
  userId: string,
  boardId: string,
): Promise<boolean> {
  const board = await tx.run(zql.boards.where('id', boardId).one());
  if (!board) return false;
  if (board.createdBy === userId) return true;

  const project = await tx.run(zql.projects.where('id', board.projectId).one());
  if (!project) return false;
  if (project.createdBy === userId) return true;

  // Channels mapped to this board (a channel can span projects, so we anchor
  // to boardId, not projectId).
  const mappings = await tx.run(
    zql.channel_board_mappings.where('boardId', boardId),
  );
  const mappedChannelIds = mappings.map(m => m.channelId);
  if (mappedChannelIds.length === 0) return false;

  const adminParticipant = await tx.run(
    zql.channel_participants
      .where('userId', userId)
      .where('role', ChannelRole.ADMIN)
      .where('channelId', 'IN', mappedChannelIds),
  );

  return adminParticipant.length > 0;
}

export class SavedUserConfigurationsACL extends BaseACL<'saved_user_configurations'> {
  constructor(ctx: QueryContext) {
    super(ctx, 'saved_user_configurations');
  }

  async canInsert(
    args: InsertValue<TableSchema<'saved_user_configurations'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    // Users can only create configs under their own userId
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Saved view insert failed: userId must match the authenticated user',
        'saved_user_configurations',
      );
    }

    if (args.visibility === SavedConfigVisibility.PUBLIC) {
      if (
        args.contextType === SavedConfigContextType.DESK_METRICS ||
        args.contextType === SavedConfigContextType.DESK_TICKET
      ) {
        if (!(await isChannelAdmin(tx, this.ctx.userID, args.contextId))) {
          throw new MutationACLError(
            'Saved view insert failed: only channel admins can create public desk views',
            'saved_user_configurations',
          );
        }
      } else {
        const allowed = await canMakePublicView(tx, this.ctx.userID, args.contextId);
        if (!allowed) {
          throw new MutationACLError(
            'Saved view insert failed: you do not have permission to create a public view',
            'saved_user_configurations',
          );
        }
      }
    }
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'saved_user_configurations'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const config = await tx.run(
      zql.saved_user_configurations.where('id', args.id).one(),
    );
    if (!config) {
      throw new MutationACLError(
        'Saved view update failed: view not found',
        'saved_user_configurations',
      );
    }
    if (config.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Saved view update failed: you can only edit your own saved views',
        'saved_user_configurations',
      );
    }

    // Only check public permission when promoting from non-public to public
    if (
      args.visibility === SavedConfigVisibility.PUBLIC &&
      config.visibility !== SavedConfigVisibility.PUBLIC
    ) {
      if (
        config.contextType === SavedConfigContextType.DESK_METRICS ||
        config.contextType === SavedConfigContextType.DESK_TICKET
      ) {
        if (!(await isChannelAdmin(tx, this.ctx.userID, config.contextId))) {
          throw new MutationACLError(
            'Saved view update failed: only channel admins can make desk views public',
            'saved_user_configurations',
          );
        }
      } else {
        const allowed = await canMakePublicView(tx, this.ctx.userID, config.contextId);
        if (!allowed) {
          throw new MutationACLError(
            'Saved view update failed: you do not have permission to make this view public',
            'saved_user_configurations',
          );
        }
      }
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'saved_user_configurations'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const config = await tx.run(
      zql.saved_user_configurations.where('id', args.id).one(),
    );
    if (!config) {
      throw new MutationACLError(
        'Saved view delete failed: view not found',
        'saved_user_configurations',
      );
    }
    if (config.userId !== this.ctx.userID) {
      throw new MutationACLError(
        'Saved view delete failed: you can only delete your own saved views',
        'saved_user_configurations',
      );
    }
  }
}
