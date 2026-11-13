/**
 * The clocks, on their own — what fires, what doesn't, and what a failure does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { useAutosave, QUIET_MS, CEILING_MS, FLOOR_MS } from './use-autosave.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Drive the hook the way the editor does: dirty in, saving out. */
function harness(opts?: { fails?: boolean }) {
  const save = vi.fn(async () => !opts?.fails);
  const view = renderHook(
    ({ dirty, saving, revision }: { dirty: boolean; saving: boolean; revision: number }) => {
      useAutosave({ dirty, saving, revision, enabled: true, save });
    },
    { initialProps: { dirty: false, saving: false, revision: 0 } },
  );
  return { save, view };
}

const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('saving on its own', () => {
  it('waits for the author to stop, then saves once', async () => {
    const { save, view } = harness();
    view.rerender({ dirty: true, saving: false, revision: 1 });

    await tick(QUIET_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await tick(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of edits into one save', async () => {
    const { save, view } = harness();
    // Five edits in quick succession, each restarting the quiet period.
    for (let i = 0; i < 5; i += 1) {
      view.rerender({ dirty: true, saving: false, revision: i + 1 });
      await tick(500);
    }
    expect(save).not.toHaveBeenCalled();
    await tick(QUIET_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('saves anyway when the editing never stops', async () => {
    const { save, view } = harness();
    // An edit every second: the quiet period never elapses, the ceiling does.
    for (let i = 0; i < CEILING_MS / 1_000; i += 1) {
      view.rerender({ dirty: true, saving: false, revision: i + 1 });
      await tick(1_000);
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does nothing while there is nothing to save', async () => {
    const { save } = harness();
    await tick(CEILING_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('never starts a second save on top of one in flight', async () => {
    const { save, view } = harness();
    view.rerender({ dirty: true, saving: true, revision: 4 });
    await tick(CEILING_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('stays quiet after a failure until the work moves on', async () => {
    const { save, view } = harness({ fails: true });
    view.rerender({ dirty: true, saving: false, revision: 5 });
    await tick(QUIET_MS);
    expect(save).toHaveBeenCalledTimes(1);

    // Still dirty, still ticking — and deliberately not retried.
    await tick(CEILING_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never writes more often than the floor, however hard it is driven', async () => {
    // The guarantee the backend is owed. Debounce alone does not give it: edits
    // spaced further apart than the quiet period each got their own save, which
    // measured at 30 a minute before the floor existed.
    for (const everyMs of [8_000, 2_000, 500, 100]) {
      const save = vi.fn(async () => true);
      let dirty = false;
      const view = renderHook(
        ({ d, r }: { d: boolean; r: number }) => { useAutosave({ dirty: d, saving: false, revision: r, enabled: true, save }); },
        { initialProps: { d: false, r: 0 } },
      );
      save.mockImplementation(async () => { dirty = false; return true; });

      const minutes = 5;
      for (let i = 1; i <= (minutes * 60_000) / everyMs; i += 1) {
        dirty = true;
        view.rerender({ d: true, r: i });
        await tick(everyMs);
        if (!dirty) view.rerender({ d: false, r: i });
      }
      const perMinute = save.mock.calls.length / minutes;
      expect(perMinute).toBeLessThanOrEqual(60_000 / FLOOR_MS + 0.5);
      view.unmount();
    }
  });

  it('is off when the host turns it off', async () => {
    const save = vi.fn(async () => true);
    const view = renderHook(
      ({ dirty }: { dirty: boolean }) => { useAutosave({ dirty, saving: false, revision: dirty, enabled: false, save }); },
      { initialProps: { dirty: false } },
    );
    view.rerender({ dirty: true });
    await tick(CEILING_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it('saves without waiting when the tab goes away', async () => {
    const { save, view } = harness();
    view.rerender({ dirty: true, saving: false, revision: 6 });

    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(save).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });
});
