import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

/**
 * A folder row carries only a name; where it sits and which hub it belongs to
 * are its containment edge, which sdlc_entity_links guards. So membership is
 * checked by the folder mutators that write the edge, and this ACL is left with
 * the tenant boundary — the same split as SdlcTracksACL.
 */
export class SdlcFoldersACL extends BaseACL<'sdlc_folders'> {
  async canInsert(
    args: InsertValue<TableSchema<'sdlc_folders'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId, 'sdlc_folders');
  }

  /** Renaming only; a folder has nothing else worth changing in place. */
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

  /**
   * Deleting a folder has to decide what happens to everything inside it and
   * clear the edges on both sides, so it belongs to a mutator that can do the
   * whole thing at once, not to a bare row delete that would strand children.
   */
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
