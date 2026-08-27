import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { isActiveConnectMember } from '../core/guest-access';
import { zql } from '../../queries';

export class LinksACL extends BaseACL<'links'> {
  async canInsert(args: InsertValue<TableSchema<'links'>>, tx: Transaction<Schema>): Promise<void> {
    // Slack-Connect: an active connect member may add links to the (host) channel cross-org.
    if (args.channelId && (await isActiveConnectMember(this.ctx, tx, args.channelId as string))) {
      return;
    }
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'links');
  }

  async canUpdate(args: UpdateValue<TableSchema<'links'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.links.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Link update failed: link does not exist', 'links');
    }
    if (row.channelId && (await isActiveConnectMember(this.ctx, tx, row.channelId))) {
      return;
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'links');
  }

  async canDelete(args: DeleteID<TableSchema<'links'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.links.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Link delete failed: link does not exist', 'links');
    }
    if (row.channelId && (await isActiveConnectMember(this.ctx, tx, row.channelId))) {
      return;
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'links');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'links'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Link upsert failed: use insert or update separately', 'links');
  }
}
