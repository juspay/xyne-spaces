import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasLabelsByCanvasId } from '../../api/canvasLabelsApi';

const getCanvasLabels = vi.fn<(ids: string[]) => Promise<CanvasLabelsByCanvasId>>();

vi.mock('../../api/canvasLabelsApi', () => ({
  canvasLabelsApi: {
    getCanvasLabels: (ids: string[]) => getCanvasLabels(ids),
  },
}));

import {
  CANVAS_LABEL_BULK_CHUNK_SIZE,
  getCachedCanvasLabels,
  invalidateCanvasLabelsForTests,
  loadCanvasLabels,
  resetCanvasLabelCacheForTests,
  trackCanvasIdsForTests,
} from './useCanvasLabels';

const labelsFor = (ids: string[], name = 'tag'): CanvasLabelsByCanvasId =>
  Object.fromEntries(
    ids.map(id => [id, [{ id: `label-${id}`, canvasId: id, name, createdAt: 1 }]]),
  );

describe('canvas label store', () => {
  beforeEach(() => {
    resetCanvasLabelCacheForTests();
    getCanvasLabels.mockReset();
    getCanvasLabels.mockImplementation((ids: string[]) => Promise.resolve(labelsFor(ids)));
  });

  it('coalesces 200 single-row requests in the same tick into bulk calls', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => `canvas-${index}`);

    await Promise.all(ids.map(id => loadCanvasLabels([id])));

    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
    expect(getCanvasLabels.mock.calls.map(([chunk]) => chunk.length)).toEqual([100, 100]);
    expect(getCachedCanvasLabels('canvas-7')?.[0]?.name).toBe('tag');
  });

  it(`splits large batches into chunks of ${CANVAS_LABEL_BULK_CHUNK_SIZE}`, async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `canvas-${index}`);

    await loadCanvasLabels(ids);

    expect(getCanvasLabels.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      100, 100, 100, 100, 50,
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
    await Promise.all([loadCanvasLabels(['a', 'b']), loadCanvasLabels(['a', 'b'])]);

    expect(getCanvasLabels).toHaveBeenCalledTimes(1);
  });

  it('re-fetches cached ids only when forced', async () => {
    await loadCanvasLabels(['a']);
    await loadCanvasLabels(['a']);
    expect(getCanvasLabels).toHaveBeenCalledTimes(1);

    await loadCanvasLabels(['a'], { force: true });
    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
  });

  it('a forced load during an in-flight request fetches again after it settles', async () => {
    getCanvasLabels
      .mockImplementationOnce(ids => Promise.resolve(labelsFor(ids, 'before')))
      .mockImplementationOnce(ids => Promise.resolve(labelsFor(ids, 'after')));

    const first = loadCanvasLabels(['a']);
    const forced = loadCanvasLabels(['a'], { force: true });
    await Promise.all([first, forced]);

    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
    expect(getCachedCanvasLabels('a')?.[0]?.name).toBe('after');
  });

  it('drops untracked ids on a label change and re-fetches tracked ones', async () => {
    await loadCanvasLabels(['shown', 'hidden']);
    const untrack = trackCanvasIdsForTests(['shown']);

    invalidateCanvasLabelsForTests('hidden');
    expect(getCachedCanvasLabels('hidden')).toBeUndefined();
    expect(getCanvasLabels).toHaveBeenCalledTimes(1);

    getCanvasLabels.mockImplementationOnce(ids => Promise.resolve(labelsFor(ids, 'renamed')));
    invalidateCanvasLabelsForTests('shown');
    await loadCanvasLabels(['shown']);
    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
    expect(getCachedCanvasLabels('shown')?.[0]?.name).toBe('renamed');

    untrack();
  });

  it('never rejects and leaves failed ids with no labels', async () => {
    getCanvasLabels.mockRejectedValueOnce(new Error('boom'));

    await expect(loadCanvasLabels(['x'])).resolves.toBeUndefined();
    expect(getCachedCanvasLabels('x')).toEqual([]);
  });
});
