import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class SdlcFoldersACL extends BaseACL<'sdlc_folders'> {
  async canInsert(
    args: InsertValue<TableSchema<'sdlc_folders'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId, 'sdlc_folders');
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'sdlc_folders'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const row = await tx.run(zql.sdlc_folders.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('SDLC folder does not exist', 'sdlc_folders');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'sdlc_folders');
  }

  async canDelete(
    _args: DeleteID<TableSchema<'sdlc_folders'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError(
      'Delete SDLC folders through the folder API so their contents are handled',
      'sdlc_folders',
    );
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'sdlc_folders'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('SDLC folders cannot be upserted', 'sdlc_folders');
  }
}
