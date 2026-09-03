import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class SdlcTracksACL extends BaseACL<'sdlc_tracks'> {
  async canInsert(
    args: InsertValue<TableSchema<'sdlc_tracks'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    // Repo-channel membership is enforced by the sdlc.createTrack mutator.
    assertWorkspaceMatch(this.ctx, args.workspaceId, 'sdlc_tracks');
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'sdlc_tracks'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const row = await tx.run(zql.sdlc_tracks.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('SDLC track does not exist', 'sdlc_tracks');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'sdlc_tracks');
  }

  async canDelete(
    _args: DeleteID<TableSchema<'sdlc_tracks'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('SDLC tracks cannot be deleted; archive them instead', 'sdlc_tracks');
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'sdlc_tracks'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('SDLC tracks cannot be upserted', 'sdlc_tracks');
  }
}
