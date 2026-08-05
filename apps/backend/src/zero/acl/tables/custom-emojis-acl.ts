import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class CustomEmojisACL extends BaseACL<'custom_emojis'> {
  async canInsert(args: InsertValue<TableSchema<'custom_emojis'>>, _tx: Transaction<Schema>): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId as string, 'custom_emojis');
  }

  async canUpdate(args: UpdateValue<TableSchema<'custom_emojis'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.custom_emojis.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Custom emoji update failed: emoji does not exist', 'custom_emojis');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'custom_emojis');
  }

  async canDelete(args: DeleteID<TableSchema<'custom_emojis'>>, tx: Transaction<Schema>): Promise<void> {
    const row = await tx.run(zql.custom_emojis.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Custom emoji delete failed: emoji does not exist', 'custom_emojis');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'custom_emojis');
  }

  async canUpsert(_args: UpsertValue<TableSchema<'custom_emojis'>>, _tx: Transaction<Schema>): Promise<void> {
    throw new MutationACLError('Custom emoji upsert failed: use insert or update separately', 'custom_emojis');
  }
}
