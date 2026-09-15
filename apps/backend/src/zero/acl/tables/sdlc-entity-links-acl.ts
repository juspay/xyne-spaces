import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import {
  SDLC_MEMBERSHIP_RELATION,
  SDLC_STRUCTURAL_RELATIONS,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  type Schema,
} from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

export class SdlcEntityLinksACL extends BaseACL<'sdlc_entity_links'> {
  async canInsert(
    args: InsertValue<TableSchema<'sdlc_entity_links'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId, 'sdlc_entity_links');
    // The edge's only scope. Every reader filters on it, so an unscoped row is
    // written and then invisible to everyone.
    if (!args.channelId) {
      throw new MutationACLError('SDLC entity links require a hub', 'sdlc_entity_links');
    }
    // Repository membership is structure, not content: only the hub endpoints write it.
    if (args.relationType === SDLC_MEMBERSHIP_RELATION) {
      throw new MutationACLError(
        'Add a repository to a space through the SDLC space API',
        'sdlc_entity_links',
      );
    }
    // Track membership is structure too, but sdlc.createTrack writes it through this
    // path, so it is gated rather than refused: the writer must be in that hub.
    if (args.relationType === SDLC_TRACK_MEMBERSHIP_RELATION) {
      const participant = await tx.run(
        zql.channel_participants
          .where('channelId', args.channelId)
          .where('userId', this.ctx.userID)
          .one(),
      );
      if (!participant) {
        throw new MutationACLError('Hub membership required', 'sdlc_entity_links');
      }
    }
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
    if ((SDLC_STRUCTURAL_RELATIONS as readonly string[]).includes(row.relationType)) {
      throw new MutationACLError(
        'Structural SDLC edges are not deleted through the link API',
        'sdlc_entity_links',
      );
    }
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'sdlc_entity_links'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('SDLC entity links cannot be upserted', 'sdlc_entity_links');
  }
}
