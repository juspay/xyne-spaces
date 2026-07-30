import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelRole, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { zql } from '../../queries';

/**
 * Classification mappings are per-desk routing config (category -> user group) for a
 * channel. They mirror the authorization of the parent desk preference
 * (see EmailChannelPreferencesACL): a write is allowed only for the desk owner
 * (email_channel_preferences.ownerUserId) or a channel admin, and only within the
 * caller's own workspace. Guests never reach this class — the factory denies them
 * via DenyGuestsACL before dispatch.
 */
export class ClassificationMappingsACL extends BaseACL<'classification_mappings'> {
  async canInsert(args: InsertValue<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    await this.assertCanManage(args.channelId, tx, 'insert');
  }

  async canUpdate(args: UpdateValue<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const channelId = await this.resolveChannelId(args.id, tx, 'update');
    await this.assertCanManage(channelId, tx, 'update');
  }

  async canDelete(args: DeleteID<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const channelId = await this.resolveChannelId(args.id, tx, 'delete');
    await this.assertCanManage(channelId, tx, 'delete');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'classification_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError(
      'Classification mapping upsert failed: use insert, update or delete operations separately',
      'classification_mappings',
    );
  }

  // For update/delete the mutator supplies only the row id, so resolve the row's
  // channelId (and confirm it belongs to the caller's workspace) before authorizing.
  private async resolveChannelId(
    id: string,
    tx: Transaction<Schema>,
    operation: 'update' | 'delete',
  ): Promise<string> {
    const mapping = await tx.run(zql.classification_mappings.where('id', id).one());
    if (!mapping) {
      throw new MutationACLError(
        `Classification mapping ${operation} failed: mapping does not exist`,
        'classification_mappings',
      );
    }
    return mapping.channelId;
  }

  private async assertCanManage(
    channelId: string,
    tx: Transaction<Schema>,
    operation: 'insert' | 'update' | 'delete',
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel || channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        `Classification mapping ${operation} failed: channel not found`,
        'classification_mappings',
      );
    }

    const participant = await tx.run(
      zql.channel_participants
        .where('channelId', channelId)
        .where('userId', this.ctx.userID)
        .one(),
    );
    if (!participant) {
      throw new MutationACLError(
        `Classification mapping ${operation} failed: you must be a channel participant`,
        'classification_mappings',
      );
    }

    if (participant.role === ChannelRole.ADMIN) return;

    const preference = await tx.run(
      zql.email_channel_preferences.where('channelId', channelId).one(),
    );
    if (preference?.ownerUserId === this.ctx.userID) return;

    throw new MutationACLError(
      `Classification mapping ${operation} failed: only the desk owner or a channel admin can manage classification mappings`,
      'classification_mappings',
    );
  }
}
