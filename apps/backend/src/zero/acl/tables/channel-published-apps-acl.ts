import type { DeleteID, InsertValue, Transaction } from '@rocicorp/zero';
import {
  MAX_PUBLISHED_APP_ID_LENGTH,
  canPublishAppsTo,
  MAX_PUBLISHED_APPS,
  isDeskChannelType,
  type Schema,
} from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, TableSchema } from '../core/types';
import { assertGuestWriteBlocked } from '../core/guest-access';
import { zql } from '../../queries';

/**
 * Who may publish (insert) or unpublish (delete) an app on a channel. Rows are
 * never updated. The rule is the shared `canPublishAppsTo`, the same one the
 * mutators run: a desk's owner or a channel ADMIN on a desk, an ADMIN on a
 * channel, any participant in a DM or group DM — nobody on a ticket/document
 * channel. Covers any write path, not just channel.publishApp/unpublishApp.
 */
export class ChannelPublishedAppsACL extends BaseACL<'channel_published_apps'> {
  async canInsert(
    args: InsertValue<TableSchema<'channel_published_apps'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'channel_published_apps', 'insert', 'Published app');

    if (args.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Publish app failed: workspace mismatch',
        'channel_published_apps'
      );
    }
    if (args.publishedBy !== this.ctx.userID) {
      throw new MutationACLError(
        'Publish app failed: publishedBy must be the caller',
        'channel_published_apps'
      );
    }
    if (!args.appId || args.appId.length > MAX_PUBLISHED_APP_ID_LENGTH) {
      throw new MutationACLError('Publish app failed: invalid app id', 'channel_published_apps');
    }

    await this.assertCanPublish(args.channelId, tx, 'Publish app');

    const existing = await tx.run(zql.channel_published_apps.where('channelId', args.channelId));
    if (existing.length >= MAX_PUBLISHED_APPS) {
      throw new MutationACLError(
        'Publish app failed: this channel already has the maximum number of published apps',
        'channel_published_apps'
      );
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'channel_published_apps'>>,
    tx: Transaction<Schema>
  ): Promise<void> {
    assertGuestWriteBlocked(this.ctx, 'channel_published_apps', 'delete', 'Published app');

    const row = await tx.run(zql.channel_published_apps.where('id', args.id).one());
    if (!row || row.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        'Unpublish app failed: published app not found in this workspace',
        'channel_published_apps'
      );
    }
    await this.assertCanPublish(row.channelId, tx, 'Unpublish app');
  }

  /** Channel exists, isn't archived, and the caller passes canPublishAppsTo. */
  private async assertCanPublish(
    channelId: string,
    tx: Transaction<Schema>,
    action: string
  ): Promise<void> {
    const channel = await tx.run(zql.channels.where('id', channelId).one());
    if (!channel || channel.workspaceId !== this.ctx.workspaceId) {
      throw new MutationACLError(
        `${action} failed: channel does not exist`,
        'channel_published_apps'
      );
    }
    if (channel.isArchived) {
      throw new MutationACLError(`${action} failed: channel is archived`, 'channel_published_apps');
    }

    const participant = await tx.run(
      zql.channel_participants.where('channelId', channelId).where('userId', this.ctx.userID).one()
    );
    let isDeskOwner = false;
    if (isDeskChannelType(channel.type)) {
      const preference = await tx.run(
        zql.email_channel_preferences.where('channelId', channelId).one()
      );
      isDeskOwner = !!preference?.ownerUserId && preference.ownerUserId === this.ctx.userID;
    }

    if (!canPublishAppsTo(channel, participant?.role, isDeskOwner)) {
      throw new MutationACLError(
        `${action} failed: you can't change the published apps of this channel`,
        'channel_published_apps'
      );
    }
  }
}
