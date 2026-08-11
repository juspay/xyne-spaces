import { commitAndSyncCanvasArtifact } from '../../src/sdlc/sdlcBaselineCanvasSync';
import type { BlockNoteBlock } from '@/types/blockNoteTypes';

describe('SDLC canvas artifact synchronization', () => {
  it('synchronizes committed artifact content before returning success', async () => {
    const events: string[] = [];
    const content: BlockNoteBlock[] = [{ id: 'block-1', type: 'paragraph', content: [] }];
    const sync = jest.fn(async () => {
      events.push('sync');
      return true;
    });

    const artifact = await commitAndSyncCanvasArtifact(async () => {
      events.push('commit');
      return { artifact: { canvasId: 'canvas-1' }, canvasId: 'canvas-1', content };
    }, sync);

    expect(events).toEqual(['commit', 'sync']);
    expect(sync).toHaveBeenCalledWith('canvas-1', content);
    expect(artifact).toEqual({ canvasId: 'canvas-1' });
  });

  it('reports failure instead of success when Y-Sweet synchronization fails', async () => {
    await expect(
      commitAndSyncCanvasArtifact(
        async () => ({ artifact: { canvasId: 'canvas-1' }, canvasId: 'canvas-1', content: [] }),
        async () => false
      )
    ).rejects.toThrow('collaboration sync failed');
  });
});
