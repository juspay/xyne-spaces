import { SDLC_CONTAINMENT_RELATION, SDLC_TRACK_FLAT_RELATION } from '@xyne/shared';
import { transaction, type TxCapableClient } from '../base';
import { refileFolderEdges, type EntityLinkActor } from '@/sdlc/entityLinkService';

/**
 * Files items a request has just created into a track: the containment edge for
 * where each sits, the flat edge for its track, and one from every folder above it.
 * Together, so an item is never in a folder without being under that folder's own
 * folders too.
 */
export function fileTrackItemsTx(
  client: TxCapableClient,
  input: {
    channelId: string;
    trackId: string;
    parent: { type: 'TRACK' | 'FOLDER'; id: string };
    items: ReadonlyArray<{ type: 'CANVAS' | 'ATTACHMENT'; id: string }>;
  },
  actor: EntityLinkActor
): Promise<void> {
  const { channelId, trackId, parent, items } = input;
  return transaction(
    ['SdlcEntityLink'],
    "fileTrackItems: an item's containment, track and folder edges must commit together; tx is not ACL-wrapped",
    client,
    async (tx) => {
      await tx.sdlcEntityLink.createMany({
        data: items.flatMap((item) => [
          {
            workspaceId: actor.workspaceId,
            channelId,
            sourceType: parent.type,
            sourceId: parent.id,
            targetType: item.type,
            targetId: item.id,
            relationType: SDLC_CONTAINMENT_RELATION,
            createdBy: actor.userId,
          },
          {
            workspaceId: actor.workspaceId,
            channelId,
            sourceType: 'TRACK',
            sourceId: trackId,
            targetType: item.type,
            targetId: item.id,
            relationType: SDLC_TRACK_FLAT_RELATION,
            createdBy: actor.userId,
          },
        ]),
        skipDuplicates: true,
      });
      for (const item of items) {
        await refileFolderEdges(tx, { channelId, item, parent }, actor);
      }
    }
  );
}
