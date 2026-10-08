import { SDLC_HUB_ITEM_FLAT_RELATION, sdlcHubKnowledgeFolderId } from '@xyne/shared';
import { db } from '@/database/client';
import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';
import { readFromYSweet } from '@/utils/ysweetUtils';

export interface HubKnowledgeDocument {
  title: string;
  markdown: string;
}

export async function readHubKnowledge(channelId: string, actorUserId: string): Promise<HubKnowledgeDocument[]> {
  const participant = await db.channelParticipant.findFirst({
    where: { channelId, userId: actorUserId, channel: { type: 'SDLC' } },
    select: { id: true },
  });
  if (!participant) return [];
  const placements = await db.sdlcEntityLink.findMany({
    where: {
      channelId,
      sourceType: 'FOLDER',
      sourceId: sdlcHubKnowledgeFolderId(channelId),
      targetType: 'CANVAS',
      relationType: SDLC_HUB_ITEM_FLAT_RELATION,
    },
    select: { targetId: true },
  });
  if (placements.length === 0) return [];
  const canvases = await db.canvas.findMany({
    where: {
      id: { in: placements.map((placement) => placement.targetId) },
      channelId,
      sdlcArtifact: { is: { artifactStatus: 'ACTIVE' } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, content: true, createdBy: true },
  });
  return Promise.all(
    canvases.map(async (canvas) => {
      // Admins edit these live, so the collaborative copy is newer than the row.
      const live = await readFromYSweet(canvas.id, canvas.createdBy);
      const blocks = live.length > 0 ? live : (canvas.content as unknown as BlockNoteBlock[]);
      return { title: canvas.title, markdown: await convertBlockNoteToMarkdown(blocks) };
    })
  );
}
