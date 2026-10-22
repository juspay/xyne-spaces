import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCanvasLabels = vi.fn();

vi.mock('../../api/canvasLabelsApi', () => ({
  canvasLabelsApi: {
    getCanvasLabels: (ids: string[]) => getCanvasLabels(ids),
  },
}));

import {
  CANVAS_LABEL_BULK_CHUNK_SIZE,
  getCachedCanvasLabels,
  loadCanvasLabels,
  resetCanvasLabelCacheForTests,
} from './useCanvasLabels';

const labelsFor = (ids: string[]) =>
  Object.fromEntries(
    ids.map(id => [id, [{ id: `label-${id}`, canvasId: id, name: 'tag', createdAt: 1 }]]),
  );

describe('canvas label store', () => {
  beforeEach(() => {
    resetCanvasLabelCacheForTests();
    getCanvasLabels.mockReset();
    getCanvasLabels.mockImplementation(async (ids: string[]) => labelsFor(ids));
  });

  it('coalesces 200 single-row requests in the same tick into one bulk call', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => `canvas-${index}`);

    await Promise.all(ids.map(id => loadCanvasLabels([id])));

    expect(getCanvasLabels).toHaveBeenCalledTimes(1);
    expect(getCanvasLabels.mock.calls[0]?.[0]).toHaveLength(200);
    expect(getCachedCanvasLabels('canvas-7')?.[0]?.name).toBe('tag');
  });

  it(`splits large batches into chunks of ${CANVAS_LABEL_BULK_CHUNK_SIZE}`, async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `canvas-${index}`);

    await loadCanvasLabels(ids);

    expect(getCanvasLabels).toHaveBeenCalledTimes(3);
    expect(getCanvasLabels.mock.calls.map(call => (call[0] as string[]).length)).toEqual([
      200, 200, 50,
    ]);
  });

  it('only fetches ids that were never loaded when the id set grows page by page', async () => {
    const pageOne = Array.from({ length: 50 }, (_, index) => `canvas-${index}`);
    const pageTwo = Array.from({ length: 50 }, (_, index) => `canvas-${index + 50}`);

    await loadCanvasLabels(pageOne);
    await loadCanvasLabels([...pageOne, ...pageTwo]);

    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
    expect(getCanvasLabels.mock.calls[1]?.[0]).toEqual(pageTwo);
  });

  it('does not request an id twice while it is in flight', async () => {
    const first = loadCanvasLabels(['a', 'b']);
    const second = loadCanvasLabels(['a', 'b']);
    await Promise.all([first, second]);

    expect(getCanvasLabels).toHaveBeenCalledTimes(1);
  });

  it('re-fetches cached ids only when forced', async () => {
    await loadCanvasLabels(['a']);
    await loadCanvasLabels(['a']);
    expect(getCanvasLabels).toHaveBeenCalledTimes(1);

    await loadCanvasLabels(['a'], { force: true });
    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
  });

  it('never rejects and leaves failed ids with no labels', async () => {
    getCanvasLabels.mockRejectedValueOnce(new Error('boom'));

    await expect(loadCanvasLabels(['x'])).resolves.toBeUndefined();
    expect(getCachedCanvasLabels('x')).toEqual([]);
  });
});
