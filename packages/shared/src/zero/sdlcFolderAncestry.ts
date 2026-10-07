import type { Transaction } from '@rocicorp/zero';
import type { Schema } from './schema.js';
import { zql } from './builder.js';
import { SDLC_FOLDER_FLAT_RELATION } from '../sdlc.js';
import { planSdlcFolderEdges, type SdlcTreeItemType } from '../sdlcFolderAncestry.js';

/**
 * Brings an item's folder edges, and those of everything under it, in line with
 * where it is now filed. Called in the same mutator that writes or removes its
 * containment edge, after that write, so the two cannot drift.
 */
export async function refileSdlcFolderEdges(
  tx: Transaction<Schema>,
  input: {
    channelId: string;
    workspaceId: string;
    userId: string;
    timestamp: number;
    /**
     * Seeds the ids of the edges this writes. The client and the server run the
     * same mutator, so ids come from its arguments rather than being made up here.
     */
    idSeed: string;
    item: { type: SdlcTreeItemType; id: string };
    /** Where it sits now; null once it no longer sits anywhere. */
    parent: { type: 'TRACK' | 'FOLDER'; id: string } | null;
  },
): Promise<void> {
  const { channelId, item, parent } = input;
  const folderEdges = zql.sdlc_entity_links
    .where('channelId', channelId)
    .where('relationType', SDLC_FOLDER_FLAT_RELATION);

  const ancestors =
    parent?.type === 'FOLDER'
      ? [
          parent.id,
          ...(
            await tx.run(folderEdges.where('targetType', 'FOLDER').where('targetId', parent.id))
          ).map(edge => edge.sourceId),
        ]
      : [];
  const descendants =
    item.type === 'FOLDER'
      ? (
          await tx.run(folderEdges.where('sourceType', 'FOLDER').where('sourceId', item.id))
        ).map(edge => ({ type: edge.targetType, id: edge.targetId }))
      : [];
  const existing = await tx.run(
    folderEdges.where(({ cmp }) =>
      cmp('targetId', 'IN', [item.id, ...descendants.map(descendant => descendant.id)]),
    ),
  );

  const plan = planSdlcFolderEdges({ item, ancestors, descendants, existing });
  for (const id of plan.remove) {
    await tx.mutate.sdlc_entity_links.delete({ id });
  }
  for (const [index, edge] of plan.add.entries()) {
    await tx.mutate.sdlc_entity_links.insert({
      id: `${input.idSeed}-${index}`,
      workspaceId: input.workspaceId,
      channelId,
      sourceType: 'FOLDER',
      sourceId: edge.sourceId,
      targetType: edge.targetType,
      targetId: edge.targetId,
      relationType: SDLC_FOLDER_FLAT_RELATION,
      createdBy: input.userId,
      createdAt: input.timestamp,
    });
  }
}
