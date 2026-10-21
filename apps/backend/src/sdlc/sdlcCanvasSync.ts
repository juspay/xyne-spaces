import { convertBlockNoteToMarkdown } from '@/services/canvasService';
import { readFromYSweet } from '@/utils/ysweetUtils';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

export interface CommittedCanvas<T> {
  artifact: T;
  canvasId: string;
  content: BlockNoteBlock[];
}

export type CanvasSync = (canvasId: string, content: BlockNoteBlock[], userId: string) => Promise<boolean>;

export async function commitAndSyncCanvasArtifact<T>(
  commit: () => Promise<CommittedCanvas<T>>,
  sync: CanvasSync,
  userId: string
): Promise<T> {
  const committed = await commit();
  const synced = await sync(committed.canvasId, committed.content, userId);
  if (!synced) {
    throw new Error('Canvas was saved, but collaboration sync failed. Retry the artifact update.');
  }
  return committed.artifact;
}

/** The live collaborative body, falling back to the stored snapshot before the first sync. */
export async function readCanvasMarkdown(canvas: {
  id: string;
  createdBy: string;
  content: unknown;
}): Promise<string> {
  const live = await readFromYSweet(canvas.id, canvas.createdBy);
  return convertBlockNoteToMarkdown(live.length > 0 ? live : (canvas.content as BlockNoteBlock[]));
}
