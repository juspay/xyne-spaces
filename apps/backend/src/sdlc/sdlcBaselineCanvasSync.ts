import type { BlockNoteBlock } from '@/types/blockNoteTypes';

export interface CommittedBaselineCanvas<T> {
  artifact: T;
  canvasId: string;
  content: BlockNoteBlock[];
}

export type BaselineCanvasSync = (canvasId: string, content: BlockNoteBlock[]) => Promise<boolean>;

export async function commitAndSyncCanvasArtifact<T>(
  commit: () => Promise<CommittedBaselineCanvas<T>>,
  sync: BaselineCanvasSync
): Promise<T> {
  const committed = await commit();
  const synced = await sync(committed.canvasId, committed.content);
  if (!synced) {
    throw new Error('Canvas was saved, but collaboration sync failed. Retry the artifact update.');
  }
  return committed.artifact;
}
