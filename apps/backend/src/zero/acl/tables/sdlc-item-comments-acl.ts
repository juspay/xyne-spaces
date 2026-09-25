import type { DeleteID, InsertValue, Transaction, UpdateValue, UpsertValue } from '@rocicorp/zero';
import type { Schema } from '@xyne/shared';
import { BaseACL } from '../core/base-acl';
import { MutationACLError, type TableSchema } from '../core/types';
import { assertWorkspaceMatch } from '../core/workspace-match';
import { zql } from '../../queries';

/** The hub is whichever channel placed the commented entity; see SdlcFoldersACL. */
async function assertHubMember(
  tx: Transaction<Schema>,
  entityId: string,
  userId: string,
): Promise<void> {
  const edges = await tx.run(zql.sdlc_entity_links.where('targetId', entityId));
  const channelIds = [
    ...new Set(edges.map((edge) => edge.channelId).filter((id): id is string => Boolean(id))),
  ];
  for (const channelId of channelIds) {
    const participant = await tx.run(
      zql.channel_participants.where('channelId', channelId).where('userId', userId).one(),
    );
    if (participant) return;
  }
  throw new MutationACLError('Hub membership required', 'sdlc_item_comments');
}

export class SdlcItemCommentsACL extends BaseACL<'sdlc_item_comments'> {
  async canInsert(
    args: InsertValue<TableSchema<'sdlc_item_comments'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    assertWorkspaceMatch(this.ctx, args.workspaceId, 'sdlc_item_comments');
    if (args.createdBy !== this.ctx.userID) {
      throw new MutationACLError('A comment is written by its author', 'sdlc_item_comments');
    }
    await assertHubMember(tx, args.entityId, this.ctx.userID);
  }

  async canUpdate(
    args: UpdateValue<TableSchema<'sdlc_item_comments'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const row = await tx.run(zql.sdlc_item_comments.where('id', args.id).one());
    if (!row) {
      throw new MutationACLError('Comment does not exist', 'sdlc_item_comments');
    }
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'sdlc_item_comments');
    await assertHubMember(tx, row.entityId, this.ctx.userID);
    // Resolving is a hub-wide act; editing the text is the author's alone.
    if (args.body !== undefined && row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the author can edit a comment', 'sdlc_item_comments');
    }
  }

  async canDelete(
    args: DeleteID<TableSchema<'sdlc_item_comments'>>,
    tx: Transaction<Schema>,
  ): Promise<void> {
    const row = await tx.run(zql.sdlc_item_comments.where('id', args.id).one());
    if (!row) return;
    assertWorkspaceMatch(this.ctx, row.workspaceId, 'sdlc_item_comments');
    if (row.createdBy !== this.ctx.userID) {
      throw new MutationACLError('Only the author can delete a comment', 'sdlc_item_comments');
    }
  }

  async canUpsert(
    _args: UpsertValue<TableSchema<'sdlc_item_comments'>>,
    _tx: Transaction<Schema>,
  ): Promise<void> {
    throw new MutationACLError('Comments cannot be upserted', 'sdlc_item_comments');
  }
}
