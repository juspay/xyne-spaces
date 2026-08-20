import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class SdlcEntityLinksACL extends BaseACL<'sdlc_entity_links'> {
  async canInsert(
    args: InsertValue<TableSchema<'sdlc_entity_links'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId, 'sdlc_entity_links');
  }

  async canUpdate(
    _args: UpdateValue<TableSchema<'sdlc_entity_links'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('SDLC entity links cannot be updated', 'sdlc_entity_links');
  }

  async canDelete(
    args: DeleteID<TableSchema<'sdlc_entity_links'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const row = await tx.run(zql.sdlc_entity_links.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('SDLC entity link does not exist', 'sdlc_entity_links');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'sdlc_entity_links');
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'sdlc_entity_links'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('SDLC entity links cannot be upserted', 'sdlc_entity_links');
  }
}
