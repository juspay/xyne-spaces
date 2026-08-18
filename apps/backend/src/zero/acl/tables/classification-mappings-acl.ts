import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { ChannelVisibility, Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ClassificationMappingsACL extends BaseACL<'classification_mappings'> {
  // Resolve channelId -> channel (workspace + PUBLIC-or-participant), mirroring the
  // ticket-channel access idiom in TicketAssignmentsACL/ChannelStatsACL.
  private async verifyChannelAccess(channelId: string, tx: Transaction<Schema>): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel || channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Classification mapping failed: channel not found in this workspace', 'classification_mappings');
    }
    if (channel.visibility === ChannelVisibility.PUBLIC) return;
    const participant = await tx.run(
      zql.channel_participants
        .where('channelId', channelId)
        .where('userId', this.ctx.userID)
        .one()
    );
    if (!participant) {
      throw new MutationACLError('Classification mapping failed: you do not have access to this channel', 'classification_mappings');
    }
  }

  // The mapping routes to a userGroupId; reject a group from another workspace.
  private async verifyUserGroupInWorkspace(userGroupId: string, tx: Transaction<Schema>): Promise<void> {
    const userGroup = await tx.run(zql.user_groups.where('id', userGroupId).one());
    if (!userGroup || userGroup.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError('Classification mapping failed: user group not found in this workspace', 'classification_mappings');
    }
  }

  async canInsert(args: InsertValue<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'classification_mappings');
    await this.verifyChannelAccess(args.channelId, tx);
    await this.verifyUserGroupInWorkspace(args.userGroupId, tx);
  }

  async canUpdate(args: UpdateValue<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.classification_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Classification mapping update failed: mapping does not exist', 'classification_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'classification_mappings');
    // Gate on the stored row's channel — non-participants of the private channel
    // must not tamper with the classification mapping.
    await this.verifyChannelAccess(row.channelId, tx);
    // channelId can be repointed on update — re-verify access to the new channel.
    if (args.channelId !== undefined) {
      await this.verifyChannelAccess(args.channelId, tx);
    }
    // userGroupId can be repointed on update — validate the new group's workspace.
    if (args.userGroupId !== undefined) {
      await this.verifyUserGroupInWorkspace(args.userGroupId, tx);
    }
  }

  async canDelete(args: DeleteID<TableSchema<'classification_mappings'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.classification_mappings.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Classification mapping delete failed: mapping does not exist', 'classification_mappings');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'classification_mappings');
    await this.verifyChannelAccess(row.channelId, tx);
  }

  async canUpsert(_args: UpsertValue<TableSchema<'classification_mappings'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Classification mapping upsert failed: use insert or update separately', 'classification_mappings');
  }
}
