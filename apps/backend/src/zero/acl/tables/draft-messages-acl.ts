import type { DeleteID, InsertValue, Transaction, UpdateValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';
import { hasChannelMutationAccess } from '../core/guest-access';

export class DraftMessagesACL extends BaseACL<'draft_messages'> {
  private async verifyChannelInWorkspace(
    channelId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) {
      throw new MutationACLError('Draft message: channel does not exist', 'draft_messages');
    }
    if (channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Draft message: channel is not in this workspace', 'draft_messages');
    }
  }

  private async ensureChannelAccess(
    channelId: string,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel) {
      throw new MutationACLError('Draft message: channel does not exist', 'draft_messages');
    }
    await this.verifyChannelInWorkspace(channelId, tx);
    if (channel.isArchived) {
      throw new MutationACLError('Draft message: channel is archived', 'draft_messages');
    }

    if (this.ctx.role === 'GUEST') {
      const hasGuestAccess = await hasChannelMutationAccess(this.ctx, tx, channelId, {
        allowPublicForNonGuests: true,
      });
      if (hasGuestAccess) {
        return;
      }
      throw new MutationACLError(
        'Draft message: guest does not have access to this channel',
        'draft_messages',
      );
    }

    if (channel.visibility === ChannelVisibility.PUBLIC) {
      return;
    }

    const participant = await tx.run(
      zql.channel_participants.where('channelId', channelId).where('userId', this.ctx.userID).one(),
    );
    if (!participant) {
      throw new MutationACLError(
        'Draft message: only channel participants can draft in this channel',
        'draft_messages',
      );
    }
  }

  async canInsert(args: InsertValue<TableSchema<'draft_messages'>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'draft_messages');
    if (args.userId !== this.ctx.userID) {
      throw new MutationACLError('Draft message insert failed: can only create drafts for yourself', 'draft_messages');
    }
    await this.ensureChannelAccess(args.channelId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'draft_messages'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.draft_messages.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Draft message update failed: not found', 'draft_messages');
    }
    await this.verifyChannelInWorkspace(row.channelId, tx);
    if (row.userId !== this.ctx.userID) {
      throw new MutationACLError('Draft message update failed: not authorized', 'draft_messages');
    }
    if (args.userId !== undefined && args.userId !== this.ctx.userID) {
      throw new MutationACLError('Draft message update failed: cannot change owner', 'draft_messages');
    }
    if (args.channelId !== undefined && args.channelId !== row.channelId) {
      await this.ensureChannelAccess(args.channelId, tx);
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'draft_messages');
  }

  async canDelete(args: DeleteID<TableSchema<'draft_messages'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.draft_messages.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Draft message delete failed: not found', 'draft_messages');
    }
    await this.verifyChannelInWorkspace(row.channelId, tx);
    if (row.userId !== this.ctx.userID) {
      throw new MutationACLError('Draft message delete failed: not authorized', 'draft_messages');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'draft_messages');
  }

  async canUpsert(args: UpsertValue<TableSchema<'draft_messages'>>, tx: Transaction<Schema>): Promise<void> {
    // Draft messages are owner-scoped: gate on both the incoming owner and the
    // existing row's owner.
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'draft_messages');
    if (args.userId && args.userId !== this.ctx.userID) {
      throw new MutationACLError('Draft message upsert failed: cannot upsert a draft for another user', 'draft_messages');
    }
    const existing = await tx.run(zql.draft_messages.where('id', args.id).one());
    if (existing && existing.userId !== this.ctx.userID) {
      throw new MutationACLError('Draft message upsert failed: cannot modify a draft you do not own', 'draft_messages');
    }
    await this.ensureChannelAccess(existing ? existing.channelId : args.channelId, tx);
  }
}
