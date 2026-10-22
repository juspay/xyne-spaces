import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasLabelsByCanvasId } from '../../api/canvasLabelsApi';

// The store installs one window-level `canvas-labels-changed` listener at import time;
// vitest runs in node, so give it a minimal window before the module loads.
vi.hoisted(() => {
  const globals = globalThis as { window?: unknown };
  if (!globals.window) globals.window = new EventTarget();
});

const getCanvasLabels = vi.fn<(ids: string[]) => Promise<CanvasLabelsByCanvasId>>();

vi.mock('../../api/canvasLabelsApi', () => ({
  canvasLabelsApi: {
    getCanvasLabels: (ids: string[]) => getCanvasLabels(ids),
  },
}));

import {
  CANVAS_LABEL_BULK_CHUNK_SIZE,
  getCachedCanvasLabels,
  isCanvasLabelInvalidatedForTests,
  loadCanvasLabels,
  notifyCanvasLabelsChanged,
  resetCanvasLabelCacheForTests,
} from './useCanvasLabels';

const labelsFor = (ids: string[]): CanvasLabelsByCanvasId =>
  Object.fromEntries(
    ids.map(id => [id, [{ id: `label-${id}`, canvasId: id, name: 'tag', createdAt: 1 }]]),
  );

describe('canvas label store', () => {
  beforeEach(() => {
    resetCanvasLabelCacheForTests();
    getCanvasLabels.mockReset();
    getCanvasLabels.mockImplementation((ids: string[]) => Promise.resolve(labelsFor(ids)));
  });

  it('coalesces single-row requests in the same tick into one bulk call', async () => {
    const ids = Array.from(
      { length: CANVAS_LABEL_BULK_CHUNK_SIZE },
      (_, index) => `canvas-${index}`,
    );

    await Promise.all(ids.map(id => loadCanvasLabels([id])));

    expect(getCanvasLabels).toHaveBeenCalledTimes(1);
    expect(getCanvasLabels.mock.calls[0]?.[0]).toHaveLength(CANVAS_LABEL_BULK_CHUNK_SIZE);
    expect(getCachedCanvasLabels('canvas-7')?.[0]?.name).toBe('tag');
  });

  it(`splits large batches into chunks of ${CANVAS_LABEL_BULK_CHUNK_SIZE}`, async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `canvas-${index}`);

    await loadCanvasLabels(ids);

    expect(CANVAS_LABEL_BULK_CHUNK_SIZE).toBe(100);
    expect(getCanvasLabels).toHaveBeenCalledTimes(5);
    expect(getCanvasLabels.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 100, 100, 50]);
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

  it('force re-fetches after an in-flight request instead of reusing its response', async () => {
    let resolveFirst: (value: CanvasLabelsByCanvasId) => void = () => undefined;
    getCanvasLabels.mockImplementationOnce(
      () =>
        new Promise<CanvasLabelsByCanvasId>(resolve => {
          resolveFirst = resolve;
        }),
    );
    getCanvasLabels.mockImplementationOnce(() =>
      Promise.resolve({ a: [{ id: 'fresh', canvasId: 'a', name: 'after-edit', createdAt: 2 }] }),
    );

    const first = loadCanvasLabels(['a']);
    await new Promise(resolve => setTimeout(resolve, 0));
    const forced = loadCanvasLabels(['a'], { force: true });
    resolveFirst({ a: [{ id: 'old', canvasId: 'a', name: 'before-edit', createdAt: 1 }] });
    await Promise.all([first, forced]);

    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
    expect(getCachedCanvasLabels('a')?.[0]?.name).toBe('after-edit');
  });

  it('marks cached labels stale on a change event even when nothing shows them', async () => {
    await loadCanvasLabels(['a']);
    expect(getCanvasLabels).toHaveBeenCalledTimes(1);

    notifyCanvasLabelsChanged('a');
    expect(isCanvasLabelInvalidatedForTests('a')).toBe(true);
    // Not on screen, so nothing is fetched until something loads it again.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getCanvasLabels).toHaveBeenCalledTimes(1);

    await loadCanvasLabels(['a']);
    expect(getCanvasLabels).toHaveBeenCalledTimes(2);
    expect(isCanvasLabelInvalidatedForTests('a')).toBe(false);
  });
});
