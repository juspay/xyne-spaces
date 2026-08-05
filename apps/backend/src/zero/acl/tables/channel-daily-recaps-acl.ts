import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class ChannelDailyRecapsACL extends BaseACL<'channel_daily_recaps'> {
  async canInsert(args: InsertValue<TableSchema<'channel_daily_recaps'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'channel_daily_recaps');
  }

  async canUpdate(args: UpdateValue<TableSchema<'channel_daily_recaps'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.channel_daily_recaps.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Channel daily recap update failed: recap does not exist', 'channel_daily_recaps');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'channel_daily_recaps');
  }

  async canDelete(args: DeleteID<TableSchema<'channel_daily_recaps'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.channel_daily_recaps.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Channel daily recap delete failed: recap does not exist', 'channel_daily_recaps');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'channel_daily_recaps');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'channel_daily_recaps'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Channel daily recap upsert failed: use insert or update separately', 'channel_daily_recaps');
  }
}
